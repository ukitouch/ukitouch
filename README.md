# ukitouch
Remote control, file transfer and more, all as extensions on a thin core!

ukitouch provides webrtc, usb and bluetooth(ongoing) as underlying supports of end-to-end communication, all the other features based on these can be implemented as extensions.

Built with Tauri 2.

> [!NOTE]
> MacOS and iOS are not supported because we don't have a member that is familiar with them. If you are interested in this project, join us!

## Extensibility
There are two types of extensions: `frontend` and `native`, declared in `manifest.json`:
```json
{
  "publisher": "",      // publisher of this extension
  "name": "",           // name of this extension
  "version": "",        // version, should be `x.x.x`
  "kind": "",           // `frontend` or `native`
  "entry": "",          // entry file of this extension, for frontend is usually a js, for native is a binary
  "style": "",          // style file of this extension, frontend only, nullable
  "platforms": [""],    // platforms this extension supports, currently `windows`, `linux`, `android` are supported
  "requires": [         // extensions this extension depends on, nullable
    {
        "publisher": "",
        "name": "",
        "version": "",
        "url": "",
    },
  ],
}
```

### Frontend Extension
A frontend extension is written in React, finally built into a js file. A function call is required:
```tsx
function defineExtension(
  /** Sidebar icon, usually svg tag. */
  icon?: React.ReactNode;
  /** Supported platforms, undefined = all. */
  platforms?: Platform[];
  /**
   * Logic layer entry, called once at app startup.
   *
   * @returns a cleanup function
   */
  activate?: (ctx: NetContext) => void | (() => void);
  /** View layer, rendered in the main area when active. */
  component?: React.ComponentType;
)
```

### Native Extension
A native extension can be written in any language in theory, as they are compiled into binaries.

The binary is launched by the host as a sidecar and talks JSON lines over stdin/stdout. Its first line must be a register:
```json
{
    "kind":"register",
    "capabilities":[""] // callable functions in this extension
}
```

For callable functions, for example, in rust:
```rs
#[derive(Deserialize)]
enum Incoming {
    Call {
        id: u64,
        method: String,
        #[serde(default)]
        payload: Value,
    },
}
#[derive(Deserialize)]
enum Outgoing {
    Reply {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

fn func() {
    let mut stdout = tokio::io::stdout();
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Incoming>(&line) else {
            continue;
        };
        match msg {
            Incoming::Call {
                id,
                method,
                payload,
            } => {
                let _ = stdout.write_all("Hello from native extension!".as_bytes()).await;
                let _ = stdout.flush().await;
            }
        }
    }
}
```

Frontend extensions call them with:
```ts
async function nativeCall<T = unknown>(
  extId: string,            // publisher.name
  method: string,           // callable function
  payload: unknown = null   // usually a Record
): Promise<T>
```

## Dev
Dependencies:
```sh
npm i
```

For desktop:
```sh
npx tauri dev
```

For Android(adb connection is required):
```sh
npm run android:debug
```