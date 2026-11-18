use tauri::WebviewWindow;

/// Enable Windows Acrylic on the current window.
#[tauri::command]
pub fn apply_window_acrylic(
    window: WebviewWindow,
    // Tint alpha 1..=255; lower = more transparent
    alpha: Option<u8>,
    r: Option<u8>,
    g: Option<u8>,
    b: Option<u8>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));

        let a = alpha.unwrap_or(120).max(1);
        // Default light acrylic tint
        let tint = (
            r.unwrap_or(245),
            g.unwrap_or(246),
            b.unwrap_or(250),
            a,
        );
        window_vibrancy::apply_acrylic(&window, Some(tint))
            .map_err(|e| format!("apply_acrylic failed: {e}"))?;

        if let Ok(hwnd) = window.hwnd() {
            apply_rounded_corners(hwnd.0 as isize);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, alpha, r, g, b);
        Ok(())
    }
}

#[cfg(windows)]
fn apply_rounded_corners(hwnd: isize) {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            attr: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: u32 = 2;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;

    unsafe {
        let round = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &round as *const u32 as *const c_void,
            4,
        );
        let none = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &none as *const u32 as *const c_void,
            4,
        );
    }
}
