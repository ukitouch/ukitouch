use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use zip::ZipArchive;

use crate::extensions::host::ExtensionHost;

const PLATFORMS: [&str; 3] = ["linux", "android", "windows"];

/// The extension's kind (native/frontend).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// `entry` is a JS file loaded into the webview.
    Frontend,
    /// `entry` is an executable run as a sidecar.
    Native,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub publisher: String,
    pub name: String,
    pub version: String,
    pub kind: Kind,
    /// The extension's entry file.
    pub entry: String,
    #[serde(default)]
    pub style: Option<String>,
    /// Extensions this one needs, as `publisher.name`.
    #[serde(default)]
    pub require: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
}

impl ExtensionManifest {
    /// Read `manifest.json` from an extension directory.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("manifest.json");
        let text = fs::read_to_string(&path).map_err(|e| format!("read manifest: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("parse manifest: {e}"))
    }

    /// `publisher.name`: the extension id and its directory name.
    pub fn id(&self) -> String {
        return format!("{}.{}", self.publisher, self.name)
    }

    pub fn is_native(&self) -> bool {
        self.kind == Kind::Native
    }

    /// Validate the manifest.
    pub fn validate(&self) -> Result<(), String> {
        if !valid_name(&self.publisher) {
            return Err(format!(
                "publisher: {:?} must be ascii alphanumeric, '_' or '-'",
                self.publisher
            ));
        }
        if !valid_name(&self.name) {
            return Err(format!(
                "name: {:?} must be ascii alphanumeric, '_' or '-'",
                self.name
            ));
        }
        if !valid_file(&self.entry) {
            return Err(format!("entry: {:?} must be a plain file name", self.entry));
        }
        for platform in &self.platforms {
            if !PLATFORMS.contains(&platform.as_str()) {
                return Err(format!(
                    "platforms: {:?} is not one of {}",
                    platform,
                    PLATFORMS.join(", ")
                ));
            }
        }
        for dep in &self.require {
            if !valid_id(dep) {
                return Err(format!("require: {dep:?} must be publisher.name"));
            }
        }
        Ok(())
    }

    /// Whether this package is declared to run on this platform.
    /// 
    /// An empty list means every platform.
    pub fn support(&self) -> bool {
        self.platforms.is_empty() || self.platforms.iter().any(|p| p == std::env::consts::OS)
    }
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

/// Read an extension's manifest.json from a directory.
#[tauri::command]
pub fn read_extension_manifest(dir: String) -> Result<ExtensionManifest, String> {
    ExtensionManifest::load(Path::new(&dir))
}

/// Read any file from an extension directory.
#[tauri::command]
pub fn read_extension_file(dir: String, file: String) -> Result<String, String> {
    let path = Path::new(&dir).join(&file);
    fs::read_to_string(&path).map_err(|e| format!("read file {}: {e}", path.display()))
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
        if hidden || !path.is_dir() {
            continue;
        }

        let Ok(mf) = ExtensionManifest::load(&path) else {
            continue;
        };
        if mf.validate().is_err() || !mf.support() || !path.join(&mf.entry).is_file() {
            continue;
        }

        out.push(ExtensionMeta {
            id: mf.id(),
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
pub async fn install_extension(
    app: AppHandle,
    host: State<'_, ExtensionHost>,
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
    mf.validate()
        .map_err(|e| format!("invalid manifest for {}: {e}", mf.id()))?;
    if !mf.support() {
        return Err(format!(
            "{} does not support {}",
            mf.id(),
            std::env::consts::OS
        ));
    }

    let id = mf.id();
    zip.by_name(&mf.entry)
        .map_err(|_| format!("{id}: missing entry file: {}", mf.entry))?;

    // lower version handle
    let dest = exts_dir.join(&id);
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
            id,
            existing_version: existing_version.unwrap_or_default(),
            incoming_version: mf.version,
        });
    }

    // install new
    // TODO: is there any memory-only way?
    let tmp = exts_dir.join(format!(".tmp-{id}"));
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

            // unix os needs to set permissions
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
            }
        }
    }

    // stop it before replacing the dir
    if mf.is_native() {
        host.shutdown(&id).await;
    }

    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("clean dest: {e}"))?;
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("install: {e}"))?;

    // Bring the native entry up without waiting for a restart.
    if mf.is_native() {
        if let Err(e) = host.launch(app, id.clone(), dest.join(&mf.entry)).await {
            eprintln!("[extensions] launch {id}: {e}");
        }
    }

    Ok(InstallOutcome::Installed {
        meta: ExtensionMeta {
            id,
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
pub async fn uninstall_extension(
    app: AppHandle,
    host: State<'_, ExtensionHost>,
    id: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid extension id".into());
    }

    host.shutdown(&id).await;

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

/// Ascii alphanumeric, `_`, `-` are allowed.
fn valid_name(part: &str) -> bool {
    !part.is_empty()
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A plain file name inside the extension directory.
fn valid_file(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// `publisher.name`.
fn valid_id(id: &str) -> bool {
    match id.split_once('.') {
        Some((publisher, name)) => valid_name(publisher) && valid_name(name),
        None => false,
    }
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
