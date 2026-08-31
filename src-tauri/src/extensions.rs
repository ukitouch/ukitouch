use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionManifest {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    platforms: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<String>,
    pub platforms: Vec<String>,
    pub dir: String,
}

/// List extensions installed under `<appDataDir>/extensions/`.
#[tauri::command]
pub fn list_installed_extensions(app: AppHandle) -> Result<Vec<ExtensionMeta>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("extensions");
    scan_extensions(&dir).map_err(|e| format!("scan {}: {e}", dir.display()))
}

#[tauri::command]
pub fn read_extension_file(dir: String, file: String) -> Result<String, String> {
    if file != "index.js" && file != "manifest.json" {
        return Err("file not allowed".into());
    }
    let path = Path::new(&dir).join(&file);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

fn scan_extensions(dir: &Path) -> Result<Vec<ExtensionMeta>, std::io::Error> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path: PathBuf = entry.path();
        if !path.is_dir() || !path.join("index.js").is_file() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let Ok(text) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(mf) = serde_json::from_str::<ExtensionManifest>(&text) else {
            continue;
        };
        out.push(ExtensionMeta {
            id: mf.id,
            name: mf.name,
            version: mf.version,
            permissions: mf.permissions,
            platforms: mf.platforms,
            dir: path.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}
