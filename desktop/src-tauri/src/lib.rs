use keyring::Entry;
use reqwest::{header::LOCATION, redirect::Policy, Client, StatusCode};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::process::Command;
use std::time::Duration;
use url::Url;

const KEYRING_SERVICE: &str = "app.howbout.companion";
const KEYRING_ACCOUNT: &str = "calendar-url";
const MAX_CALENDAR_BYTES: usize = 5 * 1024 * 1024;
const HOWBOUT_DOWNLOAD_URL: &str = "https://get.howbout.app";
const HOWBOUT_EXPORT_HELP_URL: &str = "https://howbout.app/get-help/export-calendar/";

fn calendar_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

fn allowed_calendar_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path();
    let apple = host
        .strip_prefix('p')
        .and_then(|host| host.strip_suffix("-caldav.icloud.com"))
        .is_some_and(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| character.is_ascii_digit())
                && path.starts_with("/published/")
        });
    let google = host == "calendar.google.com" && path.starts_with("/calendar/ical/");
    let outlook = matches!(host.as_str(), "outlook.live.com" | "outlook.office365.com")
        && path.starts_with("/owa/calendar/");
    apple || google || outlook
}

fn allowed_external_url(url: &str) -> bool {
    matches!(url, HOWBOUT_DOWNLOAD_URL | HOWBOUT_EXPORT_HELP_URL)
}

#[cfg(target_os = "macos")]
fn launch_external(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "The system browser could not be opened.".to_string())
}

#[cfg(target_os = "linux")]
fn launch_external(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "The system browser could not be opened.".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn launch_external(_url: &str) -> Result<(), String> {
    Err("Opening links is supported on macOS and Linux.".to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<bool, String> {
    if !allowed_external_url(&url) {
        return Err("Only official Howbout links can be opened.".to_string());
    }
    launch_external(&url)?;
    Ok(true)
}

#[tauri::command]
async fn fetch_calendar(url: String) -> Result<String, String> {
    let mut current = Url::parse(&url.replace("webcal://", "https://"))
        .map_err(|_| "Paste a valid public calendar link.".to_string())?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "The secure calendar connection could not start.".to_string())?;

    for _ in 0..=3 {
        if !allowed_calendar_url(&current) {
            return Err("Use a public Apple, Google, or Outlook calendar link.".to_string());
        }
        let response = client
            .get(current.clone())
            .header("accept", "text/calendar, text/plain;q=0.9")
            .send()
            .await
            .map_err(|_| "The calendar host could not be reached.".to_string())?;

        if matches!(
            response.status(),
            StatusCode::MOVED_PERMANENTLY
                | StatusCode::FOUND
                | StatusCode::SEE_OTHER
                | StatusCode::TEMPORARY_REDIRECT
                | StatusCode::PERMANENT_REDIRECT
        ) {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "The calendar redirected without a destination.".to_string())?;
            current = current
                .join(location)
                .map_err(|_| "The calendar returned an invalid redirect.".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err("The calendar host rejected that link.".to_string());
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_CALENDAR_BYTES as u64)
        {
            return Err("That calendar is too large to import.".to_string());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "The calendar download was interrupted.".to_string())?;
        if bytes.len() > MAX_CALENDAR_BYTES {
            return Err("That calendar is too large to import.".to_string());
        }
        let calendar = String::from_utf8(bytes.to_vec())
            .map_err(|_| "That calendar uses an unsupported text encoding.".to_string())?;
        if !calendar.contains("BEGIN:VCALENDAR") {
            return Err("That link did not return an iCalendar feed.".to_string());
        }
        return Ok(calendar);
    }
    Err("The calendar redirected too many times.".to_string())
}

#[tauri::command]
fn save_calendar_url(url: String) -> Result<bool, String> {
    calendar_entry()?
        .set_password(&url)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_calendar_url() -> Result<String, String> {
    match calendar_entry()?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clear_calendar_url() -> Result<bool, String> {
    match calendar_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(true),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_calendar,
            save_calendar_url,
            load_calendar_url,
            clear_calendar_url,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running Howbout Companion");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_supported_public_calendar_hosts() {
        assert!(allowed_calendar_url(
            &Url::parse("https://p47-caldav.icloud.com/published/2/example").unwrap()
        ));
        assert!(allowed_calendar_url(
            &Url::parse("https://calendar.google.com/calendar/ical/example/basic.ics").unwrap()
        ));
        assert!(allowed_calendar_url(
            &Url::parse("https://outlook.live.com/owa/calendar/example/calendar.ics").unwrap()
        ));
    }

    #[test]
    fn blocks_private_or_lookalike_hosts() {
        assert!(!allowed_calendar_url(
            &Url::parse("http://p47-caldav.icloud.com/published/2/example").unwrap()
        ));
        assert!(!allowed_calendar_url(
            &Url::parse("https://p-caldav.icloud.com/published/2/example").unwrap()
        ));
        assert!(!allowed_calendar_url(
            &Url::parse("https://p47-caldav.icloud.com.evil.test/published/2/example").unwrap()
        ));
        assert!(!allowed_calendar_url(
            &Url::parse("https://127.0.0.1/published/2/example").unwrap()
        ));
    }

    #[test]
    fn opens_only_exact_official_external_urls() {
        assert!(allowed_external_url(HOWBOUT_DOWNLOAD_URL));
        assert!(allowed_external_url(HOWBOUT_EXPORT_HELP_URL));
        assert!(!allowed_external_url("http://get.howbout.app"));
        assert!(!allowed_external_url("https://get.howbout.app.evil.test"));
        assert!(!allowed_external_url(
            "https://howbout.app/get-help/export-calendar/?next=evil"
        ));
    }
}
