# ukitouch
> ongoing project

Remote control, file transfer and more, all as extensions on a thin core!

ukitouch provides webrtc, usb and bluetooth(ongoing) as underlying supports of end-to-end communication, all the other features based on these can be implemented as extensions.

Built with Tauri 2.

> [!NOTE]
> Signaling server is required for yourself due to security issues, as they are configurable in settings page. A signaling server backend can refer to [this](https://github.com/ukitouch/p2p-signaling-rs)

> [!TIP]
> MacOS and iOS are not supported because we don't have a member that is familiar with them. If you are interested in this project, join us!

## Extensibility
Each extension is packed into a zip file. There are two types of extensions: `frontend` and `native`, declared in `manifest.json`:
```jsonc
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
        "platforms": [""], // specific platforms need this requirement, empty means all, nullable
        "url": "",      // nullable
    },
  ],
}
```

### Frontend Extension
A frontend extension is written in React, finally built into a js file. API types are published as [@ukitouch/extension](https://www.npmjs.com/package/@ukitouch/extension), install it with:
```sh
npm i -D @ukitouch/extension
```

Note that `react`, `react/jsx-runtime`, `@ukitouch/extension` should not be included in the bundle while building the extension.

A function call is required to register itself:
```tsx
function defineExtension(
  /** Sidebar icon, usually svg tag. */
  icon?: React.ReactNode;
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
A native extension can be written in any language in theory, as long as they are compiled into executable binaries.

The binary is launched by the host as a sidecar and talks JSON lines over stdin/stdout. For example, in rust:
```rs
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Incoming {
    Call {
        id: u64,
        method: String,
        #[serde(default)]
        payload: Value,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
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
            continue; // not a call, ignore
        };
        match msg {
            Incoming::Call { id, method, payload } => {
                let result = /* do the work */;
                // reply with the same `id` the host assigned
                let reply = Outgoing::Reply {
                    id,
                    result: Some(result),
                    error: None,
                };
                writeln!(stdout, "{}", serde_json::to_string(&reply).unwrap()).await;
            }
        }
    }
}
```

The `id` is assigned by the host per request and only used to pair the reply with the pending call. Only JSON lines may be written to stdout, anything else is logged to the host's stderr and ignored.

Frontend extensions call them with:
```ts
async function nativeCall<T = unknown>(
  extId: string,            // publisher.name
  method: string,           // callable function
  payload: unknown = null   // usually a Record
): Promise<T>
```

## Dev
For this repository.

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
