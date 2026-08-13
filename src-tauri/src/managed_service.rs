use chrono::DateTime;
use serde::{Deserialize, Deserializer};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_DISPLAY_NAME_CHARS: usize = 80;
const MAX_STATUS_CHARS: usize = 80;
const MAX_DATE_TIME_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubscriptionPlan {
    Free,
    Pro,
    LifetimeStarter,
    AppsumoTier1,
    AppsumoTier2,
    AppsumoTier3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubscriptionSource {
    Free,
    Stripe,
    Creem,
    Lifetime,
    Appsumo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LicenseStatus {
    Pending,
    Active,
    Refunded,
    Deactivated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum QuotaModel {
    LegacyDualMeter,
    CloudWords,
}

/// Strict native representation of the managed-service subscription status.
///
/// The wire type below performs the map decoding so this public type can reject invalid
/// cross-field combinations during deserialization as well as unknown or missing fields.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "SubscriptionStatusWire"
)]
pub struct SubscriptionStatus {
    plan: SubscriptionPlan,
    source: SubscriptionSource,
    display_name: String,
    subscription_end: Option<String>,
    subscription_status: Option<String>,
    license_status: Option<LicenseStatus>,
    quota_model: QuotaModel,
    display_words_used_estimate: u64,
    display_words_limit: u64,
    display_words_reset_at: Option<String>,
    stt_seconds_used: f64,
    stt_seconds_limit: f64,
    llm_tokens_used: u64,
    llm_tokens_limit: u64,
    cloud_words_used: u64,
    cloud_words_limit: u64,
    cloud_words_reset_at: Option<String>,
    byok_unlimited: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscriptionStatusWire {
    plan: SubscriptionPlan,
    source: SubscriptionSource,
    display_name: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    subscription_end: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    subscription_status: Option<String>,
    license_status: Option<LicenseStatus>,
    quota_model: QuotaModel,
    display_words_used_estimate: u64,
    display_words_limit: u64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    display_words_reset_at: Option<String>,
    stt_seconds_used: f64,
    stt_seconds_limit: f64,
    llm_tokens_used: u64,
    llm_tokens_limit: u64,
    cloud_words_used: u64,
    cloud_words_limit: u64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    cloud_words_reset_at: Option<String>,
    byok_unlimited: bool,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

impl TryFrom<SubscriptionStatusWire> for SubscriptionStatus {
    type Error = String;

    fn try_from(wire: SubscriptionStatusWire) -> Result<Self, Self::Error> {
        if !valid_plan_source_pair(wire.plan, wire.source) {
            return Err("subscription plan and source do not match".to_string());
        }
        if wire.display_name.trim().is_empty()
            || wire.display_name.chars().count() > MAX_DISPLAY_NAME_CHARS
        {
            return Err("displayName is invalid".to_string());
        }
        if wire
            .subscription_status
            .as_ref()
            .is_some_and(|value| value.chars().count() > MAX_STATUS_CHARS)
        {
            return Err("subscriptionStatus is invalid".to_string());
        }
        for value in [
            wire.subscription_end.as_deref(),
            wire.display_words_reset_at.as_deref(),
            wire.cloud_words_reset_at.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !is_bounded_rfc3339(value) {
                return Err("subscription date is invalid".to_string());
            }
        }
        for value in [
            wire.display_words_used_estimate,
            wire.display_words_limit,
            wire.llm_tokens_used,
            wire.llm_tokens_limit,
            wire.cloud_words_used,
            wire.cloud_words_limit,
        ] {
            if value > MAX_SAFE_INTEGER {
                return Err("subscription quota exceeds the safe integer range".to_string());
            }
        }
        for value in [wire.stt_seconds_used, wire.stt_seconds_limit] {
            if !value.is_finite() || value < 0.0 || value > MAX_SAFE_INTEGER as f64 {
                return Err("subscription usage is invalid".to_string());
            }
        }

        Ok(Self {
            plan: wire.plan,
            source: wire.source,
            display_name: wire.display_name,
            subscription_end: wire.subscription_end,
            subscription_status: wire.subscription_status,
            license_status: wire.license_status,
            quota_model: wire.quota_model,
            display_words_used_estimate: wire.display_words_used_estimate,
            display_words_limit: wire.display_words_limit,
            display_words_reset_at: wire.display_words_reset_at,
            stt_seconds_used: wire.stt_seconds_used,
            stt_seconds_limit: wire.stt_seconds_limit,
            llm_tokens_used: wire.llm_tokens_used,
            llm_tokens_limit: wire.llm_tokens_limit,
            cloud_words_used: wire.cloud_words_used,
            cloud_words_limit: wire.cloud_words_limit,
            cloud_words_reset_at: wire.cloud_words_reset_at,
            byok_unlimited: wire.byok_unlimited,
        })
    }
}

impl SubscriptionStatus {
    /// Return whether the server response represents a managed-cloud entitlement.
    ///
    /// This intentionally evaluates the typed, fully validated response. A plan label alone,
    /// an impossible plan/source pair, or an inactive AppSumo license can never grant access.
    pub fn has_cloud_access(&self) -> bool {
        if matches!(
            self.license_status,
            Some(LicenseStatus::Refunded | LicenseStatus::Deactivated)
        ) {
            return false;
        }

        match (self.plan, self.source) {
            (SubscriptionPlan::Free, SubscriptionSource::Free) => false,
            (SubscriptionPlan::Pro, SubscriptionSource::Stripe | SubscriptionSource::Creem) => {
                self.cloud_words_limit > 0
                    && matches!(
                        self.subscription_status.as_deref(),
                        Some("active" | "trialing")
                    )
            }
            (SubscriptionPlan::LifetimeStarter, SubscriptionSource::Lifetime) => {
                self.cloud_words_limit > 0
            }
            (
                SubscriptionPlan::AppsumoTier1
                | SubscriptionPlan::AppsumoTier2
                | SubscriptionPlan::AppsumoTier3,
                SubscriptionSource::Appsumo,
            ) => self.cloud_words_limit > 0 && self.license_status == Some(LicenseStatus::Active),
            _ => false,
        }
    }
}

fn valid_plan_source_pair(plan: SubscriptionPlan, source: SubscriptionSource) -> bool {
    matches!(
        (plan, source),
        (SubscriptionPlan::Free, SubscriptionSource::Free)
            | (
                SubscriptionPlan::Pro,
                SubscriptionSource::Stripe | SubscriptionSource::Creem
            )
            | (
                SubscriptionPlan::LifetimeStarter,
                SubscriptionSource::Lifetime
            )
            | (
                SubscriptionPlan::AppsumoTier1
                    | SubscriptionPlan::AppsumoTier2
                    | SubscriptionPlan::AppsumoTier3,
                SubscriptionSource::Appsumo
            )
    )
}

fn is_bounded_rfc3339(value: &str) -> bool {
    if value.len() > MAX_DATE_TIME_BYTES || !value.is_ascii() {
        return false;
    }

    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }

    let timezone_start = if bytes.get(19) == Some(&b'.') {
        let fractional_digits = bytes[20..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if !(1..=9).contains(&fractional_digits) {
            return false;
        }
        20 + fractional_digits
    } else {
        19
    };
    let timezone = &value[timezone_start..];
    let timezone_is_valid = timezone == "Z"
        || (timezone.len() == 6
            && matches!(timezone.as_bytes()[0], b'+' | b'-')
            && timezone.as_bytes()[1..3].iter().all(u8::is_ascii_digit)
            && timezone.as_bytes()[3] == b':'
            && timezone.as_bytes()[4..6].iter().all(u8::is_ascii_digit));

    timezone_is_valid && DateTime::parse_from_rfc3339(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn valid_status() -> Value {
        json!({
            "plan": "pro",
            "source": "creem",
            "displayName": "Pro",
            "subscriptionEnd": "2026-12-31T00:00:00Z",
            "subscriptionStatus": "active",
            "licenseStatus": null,
            "quotaModel": "legacy_dual_meter",
            "displayWordsUsedEstimate": 2500,
            "displayWordsLimit": 100000,
            "displayWordsResetAt": "2026-08-31T00:00:00.000Z",
            "sttSecondsUsed": 100.5,
            "sttSecondsLimit": 36000,
            "llmTokensUsed": 5000,
            "llmTokensLimit": 5000000,
            "cloudWordsUsed": 2500,
            "cloudWordsLimit": 100000,
            "cloudWordsResetAt": "2026-08-31T00:00:00+00:00",
            "byokUnlimited": true
        })
    }

    fn parse(value: Value) -> Result<SubscriptionStatus, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn complete_valid_plans_parse_and_apply_entitlement_rules() {
        let pro = parse(valid_status()).unwrap();
        assert!(pro.has_cloud_access());

        let mut stripe_pro = valid_status();
        stripe_pro["source"] = json!("stripe");
        assert!(parse(stripe_pro).unwrap().has_cloud_access());

        let mut free = valid_status();
        free["plan"] = json!("free");
        free["source"] = json!("free");
        free["displayName"] = json!("Free");
        free["cloudWordsLimit"] = json!(0);
        assert!(!parse(free).unwrap().has_cloud_access());

        let mut lifetime = valid_status();
        lifetime["plan"] = json!("lifetime_starter");
        lifetime["source"] = json!("lifetime");
        lifetime["displayName"] = json!("Lifetime Starter");
        lifetime["licenseStatus"] = json!("active");
        lifetime["cloudWordsLimit"] = json!(25_000);
        assert!(parse(lifetime).unwrap().has_cloud_access());

        let mut lifetime_without_license = valid_status();
        lifetime_without_license["plan"] = json!("lifetime_starter");
        lifetime_without_license["source"] = json!("lifetime");
        lifetime_without_license
            .as_object_mut()
            .unwrap()
            .remove("licenseStatus");
        assert!(parse(lifetime_without_license).unwrap().has_cloud_access());

        for plan in ["appsumo_tier1", "appsumo_tier2", "appsumo_tier3"] {
            let mut appsumo = valid_status();
            appsumo["plan"] = json!(plan);
            appsumo["source"] = json!("appsumo");
            appsumo["displayName"] = json!("AppSumo");
            appsumo["licenseStatus"] = json!("active");
            assert!(parse(appsumo).unwrap().has_cloud_access());
        }
    }

    #[test]
    fn partial_missing_unknown_and_mismatched_payloads_are_rejected() {
        assert!(parse(json!({"plan": "pro"})).is_err());

        for field in [
            "plan",
            "source",
            "displayName",
            "subscriptionEnd",
            "subscriptionStatus",
            "quotaModel",
            "displayWordsUsedEstimate",
            "displayWordsLimit",
            "displayWordsResetAt",
            "sttSecondsUsed",
            "sttSecondsLimit",
            "llmTokensUsed",
            "llmTokensLimit",
            "cloudWordsUsed",
            "cloudWordsLimit",
            "cloudWordsResetAt",
            "byokUnlimited",
        ] {
            let mut missing = valid_status();
            missing.as_object_mut().unwrap().remove(field);
            assert!(parse(missing).is_err(), "accepted missing {field}");
        }

        let mut unknown = valid_status();
        unknown["isAdmin"] = json!(true);
        assert!(parse(unknown).is_err());

        let mut mismatched = valid_status();
        mismatched["source"] = json!("appsumo");
        assert!(parse(mismatched).is_err());
    }

    #[test]
    fn invalid_numeric_values_are_rejected() {
        for field in [
            "displayWordsUsedEstimate",
            "displayWordsLimit",
            "llmTokensUsed",
            "llmTokensLimit",
            "cloudWordsUsed",
            "cloudWordsLimit",
        ] {
            let mut negative = valid_status();
            negative[field] = json!(-1);
            assert!(parse(negative).is_err(), "accepted negative {field}");

            let mut unsafe_integer = valid_status();
            unsafe_integer[field] = json!(MAX_SAFE_INTEGER + 1);
            assert!(
                parse(unsafe_integer).is_err(),
                "accepted unsafe integer {field}"
            );
        }

        for field in ["sttSecondsUsed", "sttSecondsLimit"] {
            let mut negative = valid_status();
            negative[field] = json!(-0.5);
            assert!(parse(negative).is_err(), "accepted negative {field}");
        }

        assert!(serde_json::from_str::<SubscriptionStatus>(
            &valid_status().to_string().replace("100.5", "1e400")
        )
        .is_err());
    }

    #[test]
    fn enum_string_and_date_constraints_are_rejected() {
        for (field, invalid) in [
            ("plan", json!("enterprise")),
            ("source", json!("partner")),
            ("licenseStatus", json!("trial")),
            ("quotaModel", json!("unlimited")),
            ("displayName", json!("   ")),
            ("subscriptionEnd", json!("tomorrow")),
            ("displayWordsResetAt", json!("2026-08-31")),
        ] {
            let mut status = valid_status();
            status[field] = invalid;
            assert!(parse(status).is_err(), "accepted invalid {field}");
        }
    }

    #[test]
    fn license_status_is_optional_but_never_fails_open() {
        let mut appsumo = valid_status();
        appsumo["plan"] = json!("appsumo_tier1");
        appsumo["source"] = json!("appsumo");
        appsumo.as_object_mut().unwrap().remove("licenseStatus");
        assert!(!parse(appsumo).unwrap().has_cloud_access());

        for license in ["pending", "refunded", "deactivated"] {
            let mut appsumo = valid_status();
            appsumo["plan"] = json!("appsumo_tier1");
            appsumo["source"] = json!("appsumo");
            appsumo["licenseStatus"] = json!(license);
            assert!(!parse(appsumo).unwrap().has_cloud_access());
        }

        let mut inactive_pro = valid_status();
        inactive_pro["subscriptionStatus"] = json!("past_due");
        assert!(!parse(inactive_pro).unwrap().has_cloud_access());

        let mut zero_quota_pro = valid_status();
        zero_quota_pro["cloudWordsLimit"] = json!(0);
        assert!(!parse(zero_quota_pro).unwrap().has_cloud_access());

        let mut revoked_pro = valid_status();
        revoked_pro["licenseStatus"] = json!("refunded");
        assert!(!parse(revoked_pro).unwrap().has_cloud_access());
    }
}
