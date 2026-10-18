use std::sync::Mutex;

use tauri::State;

use super::{create, InputBackend, InputEvent};

/// The backend, kept alive across command calls.
#[derive(Default)]
pub struct InputState(Mutex<Option<Box<dyn InputBackend>>>);

/// Bring the backend up.
#[tauri::command]
pub fn input_start(state: State<'_, InputState>) -> Result<(), String> {
    let mut held = state.0.lock().unwrap();
    if held.is_none() {
        *held = Some(create()?);
    }
    Ok(())
}

/// Synthesize a batch of events in order.
#[tauri::command]
pub fn input_inject(state: State<'_, InputState>, events: Vec<InputEvent>) -> Result<(), String> {
    let mut held = state.0.lock().unwrap();
    let backend = held.as_mut().ok_or("input not started")?;
    backend.inject(&events)
}

/// Release everything held down.
#[tauri::command]
pub fn input_release(state: State<'_, InputState>) {
    if let Some(backend) = state.0.lock().unwrap().as_mut() {
        backend.release();
    }
}

/// Release and drop the backend.
#[tauri::command]
pub fn input_stop(state: State<'_, InputState>) {
    let mut held = state.0.lock().unwrap();
    if let Some(backend) = held.as_mut() {
        backend.release();
    }
    *held = None;
}
