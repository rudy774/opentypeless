//! Captures and restores the exact control focused when dictation starts.
//!
//! Windows UI Automation objects are apartment-bound COM interfaces. They are
//! therefore created, retained, and used on one dedicated worker thread. The
//! recording pipeline only carries an opaque generation token.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FocusTargetToken {
    generation: u64,
}

impl FocusTargetToken {
    pub fn generation(self) -> u64 {
        self.generation
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusRestoreOutcome {
    AlreadyFocused,
    Restored,
    TokenExpired,
    CaptureUnavailable,
    TargetClosed,
    ElementUnavailable,
    ActivationFailed,
    VerificationFailed,
    TimedOut,
    Unsupported,
}

impl FocusRestoreOutcome {
    pub fn is_success(self) -> bool {
        matches!(self, Self::AlreadyFocused | Self::Restored)
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{AtomicU64, FocusRestoreOutcome, FocusTargetToken, Ordering};
    use std::mem::size_of;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, CUIAutomation8, IUIAutomation, IUIAutomationElement,
    };
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow, ShowWindow, GA_ROOT, GUITHREADINFO, SW_RESTORE,
    };

    const CAPTURE_TIMEOUT: Duration = Duration::from_millis(900);
    const VERIFY_TIMEOUT: Duration = Duration::from_millis(500);
    const RESTORE_TIMEOUT: Duration = Duration::from_millis(1_800);
    const RESTORE_ATTEMPTS: usize = 5;
    const RESTORE_RETRY_DELAY: Duration = Duration::from_millis(40);

    #[derive(Clone)]
    pub struct FocusTargetManager {
        runtime: Arc<Runtime>,
    }

    struct Runtime {
        sender: mpsc::Sender<WorkerCommand>,
        generation: AtomicU64,
    }

    enum WorkerCommand {
        Capture {
            token: FocusTargetToken,
            reply: mpsc::Sender<Option<FocusTargetToken>>,
        },
        Restore {
            token: FocusTargetToken,
            reply: mpsc::Sender<FocusRestoreOutcome>,
        },
        Verify {
            token: FocusTargetToken,
            reply: mpsc::Sender<bool>,
        },
    }

    struct SavedWindowsTarget {
        token: FocusTargetToken,
        process_id: u32,
        target_thread_id: u32,
        top_level_window: HWND,
        native_focus_window: Option<HWND>,
        automation_element: Option<IUIAutomationElement>,
    }

    #[derive(Clone, Copy, Debug)]
    enum CaptureFailure {
        NoForegroundWindow,
        NoProcess,
        SecureField,
        NoExactControl,
    }

    struct ComSession;

    impl Drop for ComSession {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    impl FocusTargetManager {
        pub fn new() -> Self {
            let (sender, receiver) = mpsc::channel();
            if let Err(error) = std::thread::Builder::new()
                .name("opentypeless-focus-target".to_string())
                .spawn(move || run_worker(receiver))
            {
                tracing::error!(%error, "Could not start the exact-focus worker");
            }
            Self {
                runtime: Arc::new(Runtime {
                    sender,
                    generation: AtomicU64::new(0),
                }),
            }
        }

        pub fn capture(&self) -> Option<FocusTargetToken> {
            let token = FocusTargetToken {
                generation: self.runtime.generation.fetch_add(1, Ordering::SeqCst) + 1,
            };
            let (reply, response) = mpsc::channel();
            if self
                .runtime
                .sender
                .send(WorkerCommand::Capture { token, reply })
                .is_err()
            {
                tracing::warn!(
                    target_generation = token.generation(),
                    "Exact-focus capture worker is unavailable"
                );
                return None;
            }
            match response.recv_timeout(CAPTURE_TIMEOUT) {
                Ok(captured) => captured,
                Err(error) => {
                    tracing::warn!(
                        target_generation = token.generation(),
                        %error,
                        "Exact-focus capture timed out"
                    );
                    None
                }
            }
        }

        pub fn restore(&self, token: FocusTargetToken) -> FocusRestoreOutcome {
            let (reply, response) = mpsc::channel();
            if self
                .runtime
                .sender
                .send(WorkerCommand::Restore { token, reply })
                .is_err()
            {
                return FocusRestoreOutcome::CaptureUnavailable;
            }
            response
                .recv_timeout(RESTORE_TIMEOUT)
                .unwrap_or(FocusRestoreOutcome::TimedOut)
        }

        pub fn is_focused(&self, token: FocusTargetToken) -> bool {
            let (reply, response) = mpsc::channel();
            if self
                .runtime
                .sender
                .send(WorkerCommand::Verify { token, reply })
                .is_err()
            {
                return false;
            }
            response.recv_timeout(VERIFY_TIMEOUT).unwrap_or(false)
        }

        pub const fn supports_exact_targets(&self) -> bool {
            true
        }
    }

    impl Default for FocusTargetManager {
        fn default() -> Self {
            Self::new()
        }
    }

    fn run_worker(receiver: mpsc::Receiver<WorkerCommand>) {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if initialized.is_err() {
            tracing::error!(
                hresult = ?initialized,
                "Could not initialize COM for exact-focus capture"
            );
            reject_worker_commands(receiver);
            return;
        }
        let _com_session = ComSession;

        let automation: windows::core::Result<IUIAutomation> = unsafe {
            CoCreateInstance(
                &CUIAutomation8,
                None::<&windows::core::IUnknown>,
                CLSCTX_INPROC_SERVER,
            )
        }
        .or_else(|_| unsafe {
            CoCreateInstance(
                &CUIAutomation,
                None::<&windows::core::IUnknown>,
                CLSCTX_INPROC_SERVER,
            )
        });
        let automation = match automation {
            Ok(automation) => automation,
            Err(error) => {
                tracing::error!(%error, "Could not initialize Windows UI Automation");
                reject_worker_commands(receiver);
                return;
            }
        };

        let mut saved_target: Option<SavedWindowsTarget> = None;
        while let Ok(command) = receiver.recv() {
            match command {
                WorkerCommand::Capture { token, reply } => {
                    match capture_current_target(&automation, token) {
                        Ok(target) => {
                            tracing::info!(
                                target_generation = token.generation(),
                                process_id = target.process_id,
                                ui_automation = target.automation_element.is_some(),
                                native_control = target.native_focus_window.is_some(),
                                "Captured exact dictation target"
                            );
                            saved_target = Some(target);
                            let _ = reply.send(Some(token));
                        }
                        Err(reason) => {
                            tracing::warn!(
                                target_generation = token.generation(),
                                ?reason,
                                "Could not capture an exact dictation target"
                            );
                            saved_target = None;
                            let _ = reply.send(None);
                        }
                    }
                }
                WorkerCommand::Restore { token, reply } => {
                    let outcome = match saved_target.as_ref() {
                        Some(target) if target.token == token => {
                            restore_saved_target(&automation, target)
                        }
                        _ => FocusRestoreOutcome::TokenExpired,
                    };
                    tracing::info!(
                        target_generation = token.generation(),
                        ?outcome,
                        "Exact dictation target restoration finished"
                    );
                    let _ = reply.send(outcome);
                }
                WorkerCommand::Verify { token, reply } => {
                    let focused = saved_target
                        .as_ref()
                        .filter(|target| target.token == token)
                        .is_some_and(|target| verify_saved_target(&automation, target));
                    tracing::debug!(
                        target_generation = token.generation(),
                        focused,
                        "Exact dictation target focus verification finished"
                    );
                    let _ = reply.send(focused);
                }
            }
        }
    }

    fn reject_worker_commands(receiver: mpsc::Receiver<WorkerCommand>) {
        while let Ok(command) = receiver.recv() {
            match command {
                WorkerCommand::Capture { reply, .. } => {
                    let _ = reply.send(None);
                }
                WorkerCommand::Restore { reply, .. } => {
                    let _ = reply.send(FocusRestoreOutcome::CaptureUnavailable);
                }
                WorkerCommand::Verify { reply, .. } => {
                    let _ = reply.send(false);
                }
            }
        }
    }

    fn capture_current_target(
        automation: &IUIAutomation,
        token: FocusTargetToken,
    ) -> Result<SavedWindowsTarget, CaptureFailure> {
        let top_level_window = unsafe { GetForegroundWindow() };
        if top_level_window.is_null() {
            return Err(CaptureFailure::NoForegroundWindow);
        }

        let mut process_id = 0u32;
        let target_thread_id =
            unsafe { GetWindowThreadProcessId(top_level_window, &mut process_id as *mut u32) };
        if process_id == 0 || target_thread_id == 0 {
            return Err(CaptureFailure::NoProcess);
        }

        let native_focus_window = unsafe { focused_window_for_thread(target_thread_id) }
            .filter(|window| unsafe { IsWindow(*window) != 0 });

        let mut automation_element =
            unsafe { automation.GetFocusedElement() }
                .ok()
                .filter(|element| {
                    unsafe { element.CurrentProcessId() }
                        .ok()
                        .is_some_and(|element_pid| element_pid == process_id as i32)
                });

        if automation_element.as_ref().is_some_and(|element| {
            unsafe { element.CurrentIsPassword() }
                .ok()
                .is_some_and(|is_password| is_password.as_bool())
        }) {
            return Err(CaptureFailure::SecureField);
        }

        // A top-level HWND alone cannot distinguish two text boxes in the same
        // application. Keep it only when UI Automation supplied an exact
        // focused element; otherwise require a real focused child control.
        if automation_element.is_none()
            && native_focus_window.is_none_or(|window| window == top_level_window)
        {
            return Err(CaptureFailure::NoExactControl);
        }

        // Avoid retaining an element that became invalid during capture. The
        // native child HWND remains a valid fallback for classic Win32 fields.
        if automation_element
            .as_ref()
            .is_some_and(|element| unsafe { element.CurrentProcessId() }.is_err())
        {
            automation_element = None;
        }

        Ok(SavedWindowsTarget {
            token,
            process_id,
            target_thread_id,
            top_level_window,
            native_focus_window,
            automation_element,
        })
    }

    fn restore_saved_target(
        automation: &IUIAutomation,
        target: &SavedWindowsTarget,
    ) -> FocusRestoreOutcome {
        if verify_saved_target(automation, target) {
            return FocusRestoreOutcome::AlreadyFocused;
        }
        if !target_is_open(target) {
            return FocusRestoreOutcome::TargetClosed;
        }

        let mut activated = false;
        let mut focus_requested = false;
        for _ in 0..RESTORE_ATTEMPTS {
            let attempt = unsafe { activate_and_focus(target) };
            activated |= attempt.0;
            focus_requested |= attempt.1;

            if let Some(element) = target.automation_element.as_ref() {
                focus_requested |= unsafe { element.SetFocus() }.is_ok();
            }

            if verify_saved_target(automation, target) {
                return FocusRestoreOutcome::Restored;
            }
            std::thread::sleep(RESTORE_RETRY_DELAY);
        }

        if !activated {
            FocusRestoreOutcome::ActivationFailed
        } else if !focus_requested {
            FocusRestoreOutcome::ElementUnavailable
        } else {
            FocusRestoreOutcome::VerificationFailed
        }
    }

    fn target_is_open(target: &SavedWindowsTarget) -> bool {
        if unsafe { IsWindow(target.top_level_window) } == 0 {
            return false;
        }
        let mut current_process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(target.top_level_window, &mut current_process_id as *mut u32)
        };
        current_process_id == target.process_id
    }

    fn verify_saved_target(automation: &IUIAutomation, target: &SavedWindowsTarget) -> bool {
        if !target_is_open(target) {
            return false;
        }
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_null() {
            return false;
        }
        let foreground_root = unsafe { GetAncestor(foreground, GA_ROOT) };
        if foreground != target.top_level_window && foreground_root != target.top_level_window {
            return false;
        }

        if let Some(expected) = target.automation_element.as_ref() {
            let Ok(current) = (unsafe { automation.GetFocusedElement() }) else {
                return false;
            };
            return unsafe { automation.CompareElements(expected, &current) }
                .ok()
                .is_some_and(|same| same.as_bool());
        }

        target.native_focus_window.is_some_and(|expected| {
            (unsafe { focused_window_for_thread(target.target_thread_id) }) == Some(expected)
        })
    }

    /// Returns `(window_activated, exact_focus_requested)`.
    unsafe fn activate_and_focus(target: &SavedWindowsTarget) -> (bool, bool) {
        ShowWindow(target.top_level_window, SW_RESTORE);

        let worker_thread_id = GetCurrentThreadId();
        let foreground_window = GetForegroundWindow();
        let foreground_thread_id = if foreground_window.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground_window, std::ptr::null_mut())
        };

        let attached_target = worker_thread_id != target.target_thread_id
            && AttachThreadInput(worker_thread_id, target.target_thread_id, 1) != 0;
        let attached_foreground = foreground_thread_id != 0
            && foreground_thread_id != worker_thread_id
            && foreground_thread_id != target.target_thread_id
            && AttachThreadInput(worker_thread_id, foreground_thread_id, 1) != 0;

        let activated = SetForegroundWindow(target.top_level_window) != 0;
        let mut focus_requested = false;
        if let Some(native_focus) = target.native_focus_window {
            if native_focus != target.top_level_window && IsWindow(native_focus) != 0 {
                focus_requested = !SetFocus(native_focus).is_null();
            }
        }

        if attached_foreground {
            AttachThreadInput(worker_thread_id, foreground_thread_id, 0);
        }
        if attached_target {
            AttachThreadInput(worker_thread_id, target.target_thread_id, 0);
        }

        (activated, focus_requested)
    }

    unsafe fn focused_window_for_thread(thread_id: u32) -> Option<HWND> {
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(thread_id, &mut info as *mut GUITHREADINFO) == 0
            || info.hwndFocus.is_null()
        {
            None
        } else {
            Some(info.hwndFocus)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{AtomicU64, FocusRestoreOutcome, FocusTargetToken, Ordering};
    use std::sync::Arc;

    #[derive(Clone, Default)]
    pub struct FocusTargetManager {
        generation: Arc<AtomicU64>,
    }

    impl FocusTargetManager {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn capture(&self) -> Option<FocusTargetToken> {
            let _ = self.generation.fetch_add(1, Ordering::SeqCst);
            None
        }

        pub fn restore(&self, _token: FocusTargetToken) -> FocusRestoreOutcome {
            FocusRestoreOutcome::Unsupported
        }

        pub fn is_focused(&self, _token: FocusTargetToken) -> bool {
            false
        }

        pub const fn supports_exact_targets(&self) -> bool {
            false
        }
    }
}

pub use platform::FocusTargetManager;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_verified_focus_outcomes_are_successful() {
        assert!(FocusRestoreOutcome::AlreadyFocused.is_success());
        assert!(FocusRestoreOutcome::Restored.is_success());
        assert!(!FocusRestoreOutcome::VerificationFailed.is_success());
        assert!(!FocusRestoreOutcome::TargetClosed.is_success());
    }
}
