use crate::credentials::{
    CredentialSecretReader, CredentialSecretRemover, CredentialVault, SystemCredentialVault,
};
use serde::Serialize;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};

const SESSION_CREDENTIAL_NAMESPACE: &str = "auth";
const SESSION_CREDENTIAL_PROVIDER_PREFIX: &str = "cloud-session-v2-";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionTokenStorage {
    OsVault,
    SessionOnly,
}

/// Cloud bearer token shared by the native STT/LLM pipeline.
///
/// The active value lives in process memory. Persistence is handled by the
/// operating system credential vault, never by a WebView storage API.
#[derive(Clone)]
pub struct SessionTokenStore(pub Arc<Mutex<String>>, Option<Arc<str>>);

impl Default for SessionTokenStore {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(String::new())), None)
    }
}

impl SessionTokenStore {
    /// Hydrate the session bound to this managed-service origin.
    ///
    /// Unconfigured builds deliberately have no credential-vault key. This also
    /// means releases predating origin scoping are never migrated implicitly.
    pub fn from_system_vault(managed_api_origin: &str) -> Self {
        let Some(provider) = session_credential_provider(managed_api_origin) else {
            return Self::default();
        };
        let store = Self(
            Arc::new(Mutex::new(String::new())),
            Some(Arc::from(provider)),
        );
        match load_token_from_vault(&SystemCredentialVault, store.provider().unwrap_or_default()) {
            Ok(token) => store.replace(token.unwrap_or_default()),
            Err(_error) => {
                tracing::warn!("Cloud session credential vault could not be read");
            }
        }
        store
    }

    pub fn token(&self) -> String {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn set_persisted(&self, token: String) -> Result<SessionTokenStorage, String> {
        set_token_with_vault(self, token, &SystemCredentialVault)
    }

    fn provider(&self) -> Option<&str> {
        self.1.as_deref()
    }

    fn replace(&self, token: String) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = token;
    }
}

fn session_credential_provider(managed_api_origin: &str) -> Option<String> {
    let parsed = url::Url::parse(managed_api_origin.trim()).ok()?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }

    // Encode the complete normalized origin rather than using a short hash so
    // distinct production/staging/source origins cannot collide.
    let normalized_origin = parsed.origin().ascii_serialization();
    let mut encoded_origin = String::with_capacity(normalized_origin.len() * 2);
    for byte in normalized_origin.as_bytes() {
        let _ = write!(&mut encoded_origin, "{byte:02x}");
    }
    Some(format!(
        "{SESSION_CREDENTIAL_PROVIDER_PREFIX}{encoded_origin}"
    ))
}

fn load_token_from_vault<V: CredentialSecretReader>(
    vault: &V,
    provider: &str,
) -> anyhow::Result<Option<String>> {
    vault.get_secret(SESSION_CREDENTIAL_NAMESPACE, provider)
}

fn set_token_with_vault<V: CredentialVault + CredentialSecretReader + CredentialSecretRemover>(
    store: &SessionTokenStore,
    token: String,
    vault: &V,
) -> Result<SessionTokenStorage, String> {
    let Some(provider) = store.provider() else {
        // A source/BYOK build must not retain a bearer even in process memory.
        store.replace(String::new());
        return Err("managed service is not configured; cloud session storage is disabled".into());
    };

    if token.is_empty() {
        // Clear process memory first. Even when the OS vault is temporarily
        // unavailable, the current process must stop using a signed-out token.
        store.replace(String::new());

        // Overwrite before deleting so a platform-specific delete failure cannot
        // resurrect the previous bearer token after restart. An empty verified
        // vault entry is a safe tombstone and is treated as signed out.
        let tombstone_verified = vault
            .set_secret(SESSION_CREDENTIAL_NAMESPACE, provider, "")
            .and_then(|()| load_token_from_vault(vault, provider))
            .map(|stored| stored.as_deref() == Some(""))
            .unwrap_or(false);

        match vault.remove_secret(SESSION_CREDENTIAL_NAMESPACE, provider) {
            Ok(()) => return Ok(SessionTokenStorage::OsVault),
            Err(_error) if tombstone_verified => {
                tracing::warn!(
                    "Cloud session vault delete failed after an empty tombstone was verified"
                );
                return Ok(SessionTokenStorage::OsVault);
            }
            Err(_error) => {
                return Err("clear cloud session credential: OS vault operation failed".into());
            }
        }
    }

    // Keep the current authenticated process usable if the platform vault is
    // temporarily unavailable. The caller can surface the session-only status;
    // no browser persistence fallback is used.
    store.replace(token.clone());
    if let Err(_error) = vault.set_secret(SESSION_CREDENTIAL_NAMESPACE, provider, &token) {
        tracing::warn!("Cloud session is memory-only because the OS vault write failed");
        return Ok(SessionTokenStorage::SessionOnly);
    }

    match load_token_from_vault(vault, provider) {
        Ok(Some(stored)) if stored == token => Ok(SessionTokenStorage::OsVault),
        Ok(_) => {
            let _ = vault.remove_secret(SESSION_CREDENTIAL_NAMESPACE, provider);
            tracing::warn!("Cloud session is memory-only because OS vault verification failed");
            Ok(SessionTokenStorage::SessionOnly)
        }
        Err(_error) => {
            tracing::warn!("Cloud session is memory-only because OS vault verification failed");
            Ok(SessionTokenStorage::SessionOnly)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{anyhow, Result};
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryVault {
        values: Mutex<HashMap<(String, String), String>>,
        fail_write: bool,
        fail_remove: bool,
    }

    impl CredentialVault for MemoryVault {
        fn set_secret(&self, namespace: &str, provider: &str, secret: &str) -> Result<()> {
            if self.fail_write {
                return Err(anyhow!("write failed"));
            }
            self.values.lock().unwrap().insert(
                (namespace.to_string(), provider.to_string()),
                secret.to_string(),
            );
            Ok(())
        }
    }

    impl CredentialSecretReader for MemoryVault {
        fn get_secret(&self, namespace: &str, provider: &str) -> Result<Option<String>> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(namespace.to_string(), provider.to_string()))
                .cloned())
        }
    }

    impl CredentialSecretRemover for MemoryVault {
        fn remove_secret(&self, namespace: &str, provider: &str) -> Result<()> {
            if self.fail_remove {
                return Err(anyhow!("remove failed"));
            }
            self.values
                .lock()
                .unwrap()
                .remove(&(namespace.to_string(), provider.to_string()));
            Ok(())
        }
    }

    fn configured_store(origin: &str) -> SessionTokenStore {
        SessionTokenStore(
            Arc::new(Mutex::new(String::new())),
            Some(Arc::from(session_credential_provider(origin).unwrap())),
        )
    }

    #[test]
    fn persists_and_verifies_session_token_in_vault() {
        let store = configured_store("https://api.example.test");
        let vault = MemoryVault::default();

        let storage = set_token_with_vault(&store, "secret-token".to_string(), &vault).unwrap();

        assert_eq!(storage, SessionTokenStorage::OsVault);
        assert_eq!(store.token(), "secret-token");
        assert_eq!(
            load_token_from_vault(&vault, store.provider().unwrap())
                .unwrap()
                .as_deref(),
            Some("secret-token")
        );
    }

    #[test]
    fn vault_write_failure_uses_memory_without_browser_fallback() {
        let store = configured_store("https://api.example.test");
        let vault = MemoryVault {
            fail_write: true,
            ..Default::default()
        };

        let storage = set_token_with_vault(&store, "secret-token".to_string(), &vault).unwrap();

        assert_eq!(storage, SessionTokenStorage::SessionOnly);
        assert_eq!(store.token(), "secret-token");
        assert_eq!(
            load_token_from_vault(&vault, store.provider().unwrap()).unwrap(),
            None
        );
    }

    #[test]
    fn clearing_removes_memory_and_vault_token() {
        let store = configured_store("https://api.example.test");
        let vault = MemoryVault::default();
        set_token_with_vault(&store, "secret-token".to_string(), &vault).unwrap();

        set_token_with_vault(&store, String::new(), &vault).unwrap();

        assert_eq!(store.token(), "");
        assert_eq!(
            load_token_from_vault(&vault, store.provider().unwrap()).unwrap(),
            None
        );
    }

    #[test]
    fn failed_vault_delete_leaves_a_safe_empty_tombstone() {
        let store = configured_store("https://api.example.test");
        let vault = MemoryVault {
            fail_remove: true,
            ..Default::default()
        };
        set_token_with_vault(&store, "secret-token".to_string(), &vault).unwrap();

        let storage = set_token_with_vault(&store, String::new(), &vault).unwrap();

        assert_eq!(storage, SessionTokenStorage::OsVault);
        assert_eq!(store.token(), "");
        assert_eq!(
            load_token_from_vault(&vault, store.provider().unwrap())
                .unwrap()
                .as_deref(),
            Some("")
        );
    }

    #[test]
    fn unavailable_vault_still_clears_process_memory_and_reports_error() {
        let store = configured_store("https://api.example.test");
        store.replace("secret-token".to_string());
        let vault = MemoryVault {
            fail_write: true,
            fail_remove: true,
            ..Default::default()
        };

        let error = set_token_with_vault(&store, String::new(), &vault).unwrap_err();

        assert!(error.contains("clear cloud session credential"));
        assert_eq!(store.token(), "");
    }

    #[test]
    fn normalized_origin_determines_the_credential_scope() {
        let canonical = session_credential_provider("https://API.Example.Test/").unwrap();
        let equivalent = session_credential_provider(" https://api.example.test ").unwrap();
        let staging = session_credential_provider("https://staging.example.test").unwrap();

        assert_eq!(canonical, equivalent);
        assert_ne!(canonical, staging);
    }

    #[test]
    fn credentials_are_isolated_between_managed_service_origins() {
        let production = configured_store("https://api.example.test");
        let staging = configured_store("https://staging.example.test");
        let vault = MemoryVault::default();

        set_token_with_vault(&production, "production-token".to_string(), &vault).unwrap();

        assert_eq!(
            load_token_from_vault(&vault, production.provider().unwrap())
                .unwrap()
                .as_deref(),
            Some("production-token")
        );
        assert_eq!(
            load_token_from_vault(&vault, staging.provider().unwrap()).unwrap(),
            None
        );
    }

    #[test]
    fn scoped_store_does_not_read_the_legacy_unscoped_credential() {
        let store = configured_store("https://api.example.test");
        let vault = MemoryVault::default();
        vault
            .set_secret(
                SESSION_CREDENTIAL_NAMESPACE,
                "cloud-session",
                "legacy-unscoped-token",
            )
            .unwrap();

        assert_eq!(
            load_token_from_vault(&vault, store.provider().unwrap()).unwrap(),
            None
        );
    }
    #[test]
    fn unconfigured_store_never_loads_or_retains_a_session() {
        assert!(session_credential_provider("managed-service-disabled://unconfigured").is_none());
        let store = SessionTokenStore::default();
        let vault = MemoryVault::default();

        let error =
            set_token_with_vault(&store, "must-not-survive".to_string(), &vault).unwrap_err();

        assert!(error.contains("managed service is not configured"));
        assert_eq!(store.token(), "");
        assert!(vault.values.lock().unwrap().is_empty());
    }
}
