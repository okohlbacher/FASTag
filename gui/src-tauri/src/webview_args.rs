//! The main window's WebView2 browser arguments (Windows).
//!
//! wry always hands WebView2 its own AdditionalBrowserArguments (the
//! defaults below), and WebView2 then does not apply the
//! WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS environment variable. That variable
//! is how msedgedriver (through tauri-driver) passes --remote-debugging-port
//! to a WebView2 app; without it every WebDriver session failed with
//! "DevToolsActivePort file doesn't exist" (WebView2 156, GitHub's x64 and
//! ARM64 Windows runners: the browser's command line carried only wry's
//! arguments while WEBVIEW2_USER_DATA_FOLDER was honoured). So when the
//! variable is set, the window is built with wry's defaults merged with it;
//! when it is not, nothing changes.

/// What wry passes when the app sets no arguments of its own (wry 0.55
/// webview2/mod.rs; autoplay is on by default).
pub const WRY_DEFAULT: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

pub const ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

/// Splits at whitespace outside double quotes.
fn tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                cur.push(c);
            }
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// wry's defaults followed by @p env, or None when @p env is unset or blank.
/// Chromium keeps only the last of repeated switches, so the feature lists
/// of both are joined into one --disable-features / --enable-features.
pub fn merged(env: Option<&str>) -> Option<String> {
    let env = env.map(str::trim).filter(|e| !e.is_empty())?;
    let mut out: Vec<String> = Vec::new();
    let mut features: [(&str, Vec<String>); 2] = [("--disable-features=", Vec::new()), ("--enable-features=", Vec::new())];
    for t in tokens(WRY_DEFAULT).into_iter().chain(tokens(env)) {
        if let Some((_, list)) = features.iter_mut().find(|(p, _)| t.starts_with(p)) {
            for f in t[t.find('=').unwrap() + 1..].split(',').filter(|f| !f.is_empty()) {
                if !list.iter().any(|x| x == f) {
                    list.push(f.to_string());
                }
            }
        } else if !out.contains(&t) {
            out.push(t);
        }
    }
    for (p, list) in features.iter().rev() {
        if !list.is_empty() {
            out.insert(0, format!("{p}{}", list.join(",")));
        }
    }
    Some(out.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_blank_changes_nothing() {
        assert_eq!(merged(None), None);
        assert_eq!(merged(Some("  ")), None);
    }

    #[test]
    fn msedgedriver_arguments_are_kept_with_wry_defaults() {
        let m = merged(Some(
            "--remote-debugging-port=0 --disable-features=IgnoreDuplicateNavs,Prewarm --disable-sync --user-agent=\"a b\"",
        ))
        .unwrap();
        assert_eq!(
            m,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IgnoreDuplicateNavs,Prewarm \
             --autoplay-policy=no-user-gesture-required --remote-debugging-port=0 --disable-sync --user-agent=\"a b\""
        );
    }

    #[test]
    fn duplicate_features_and_switches_once() {
        let m = merged(Some("--disable-features=msWebOOUI --enable-features=X --autoplay-policy=no-user-gesture-required")).unwrap();
        assert_eq!(
            m,
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-features=X --autoplay-policy=no-user-gesture-required"
        );
    }
}
