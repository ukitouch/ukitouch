use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

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

/// Result of an install attempt: written, blocked
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InstallOutcome {
    Installed {
        meta: ExtensionMeta,
    },
    OverrideConfirm {
        id: String,
        existing_version: String,
        incoming_version: String,
    },
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
pub fn read_extension_script(dir: String) -> Result<String, String> {
    let path = Path::new(&dir).join("index.js");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Scan extensions in given `dir`.
fn scan_extensions(dir: &Path) -> Result<Vec<ExtensionMeta>, std::io::Error> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path: PathBuf = entry.path();
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(true);
        if hidden || !path.is_dir() || !path.join("index.js").is_file() {
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

/// Install an extension from a zip into `<appDataDir>/extensions/<id>/`.
#[tauri::command]
pub fn install_extension(
    app: AppHandle,
    zip_base64: String,
    force: bool,
) -> Result<InstallOutcome, String> {
    let exts_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("extensions");
    let bytes = STANDARD
        .decode(&zip_base64)
        .map_err(|e| format!("decode zip: {e}"))?;
    let mut zip = ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("read zip: {e}"))?;

    // validity check
    let manifest_text = {
        let mut f = zip
            .by_name("manifest.json")
            .map_err(|_| "missing manifest.json".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s)
            .map_err(|e| format!("read manifest: {e}"))?;
        s
    };
    let mf: ExtensionManifest =
        serde_json::from_str(&manifest_text).map_err(|e| format!("bad manifest: {e}"))?;
    if !valid_ext_id(&mf.id) {
        return Err(format!("invalid extension id: {}", mf.id));
    }
    zip.by_name("index.js")
        .map_err(|_| "missing index.js".to_string())?;

    // lower version handle
    let dest = exts_dir.join(&mf.id);
    let existing_version = fs::read_to_string(dest.join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<ExtensionManifest>(&t).ok())
        .map(|m| m.version);
    if !force
        && !existing_version
            .as_deref()
            .is_none_or(|v| version_gt(&mf.version, v))
    {
        return Ok(InstallOutcome::OverrideConfirm {
            id: mf.id,
            existing_version: existing_version.unwrap_or_default(),
            incoming_version: mf.version,
        });
    }

    // install new
    // TODO: is there any memory-only way?
    let tmp = exts_dir.join(format!(".tmp-{}", mf.id));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| format!("clean tmp: {e}"))?;
    }
    fs::create_dir_all(&tmp).map_err(|e| format!("create tmp: {e}"))?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("read entry: {e}"))?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("unsafe path in zip: {}", entry.name()));
        };
        let out = tmp.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| format!("mkdir: {e}"))?;
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(|e| format!("mkdir: {e}"))?;
            }
            let mut f = fs::File::create(&out).map_err(|e| format!("create: {e}"))?;
            std::io::copy(&mut entry, &mut f).map_err(|e| format!("extract: {e}"))?;
        }
    }

    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("clean dest: {e}"))?;
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("install: {e}"))?;

    Ok(InstallOutcome::Installed {
        meta: ExtensionMeta {
            id: mf.id,
            name: mf.name,
            version: mf.version,
            permissions: mf.permissions,
            platforms: mf.platforms,
            dir: dest.to_string_lossy().into_owned(),
        },
    })
}

/// Remove an installed extension from `<appDataDir>/extensions/<id>/`.
#[tauri::command]
pub fn uninstall_extension(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_ext_id(&id) {
        return Err("invalid extension id".into());
    }

    let exts_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("extensions");
    for dir in [exts_dir.join(&id), exts_dir.join(format!(".tmp-{id}"))] {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("remove {id}: {e}"))?;
        }
    }
    Ok(())
}

fn valid_ext_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// Versions are `x.x.x`. Returns `None` if that shape is not met.
fn parse_version(v: &str) -> Option<[u32; 3]> {
    let mut parts = v.trim().split('.');
    let out = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    parts.next().is_none().then_some(out)
}

/// Whether `a`'s version is greater than `b`.
fn version_gt(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}
