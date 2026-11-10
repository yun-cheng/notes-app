//! A thin native shell around the web app. The window loads the live site, so sign-in, sync and
//! updates work exactly as in a browser, and the site gets no access to native APIs. Anything
//! outside the app's own site, like a link in a note or the browser sign-in page, opens in the
//! system browser instead of inside the app.

use tauri::webview::NewWindowResponse;
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const HOST: &str = "notes-app-afc.pages.dev";
/// `shell=native` tells the web app it is inside this shell, so it offers browser sign-in.
const START: &str = "https://notes-app-afc.pages.dev/?shell=native";

fn belongs_in_app(url: &Url) -> bool {
    url.host_str() == Some(HOST) || matches!(url.scheme(), "tauri" | "asset" | "about" | "blob" | "data") || url.host_str() == Some("tauri.localhost")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let on_nav = app.handle().clone();
            let on_new = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(START.parse().expect("start URL")))
                .on_navigation(move |url| {
                    if belongs_in_app(url) {
                        return true;
                    }
                    let _ = on_nav.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _features| {
                    let _ = on_new.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                });
            #[cfg(desktop)]
            let builder = builder.title("Notes").inner_size(1100.0, 760.0).min_inner_size(360.0, 480.0);
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Notes app");
}
