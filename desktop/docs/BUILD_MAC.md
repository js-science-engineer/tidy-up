# js-pet · macOS 构建说明（BUILD_MAC）

> 适用于 js-pet 0.1.0（Electron 44 + electron-builder 26）。
> Windows 机器**无法**完成 macOS 包的构建与验证（electron-builder 官方限制），本说明供在任意一台 macOS 机器上直接执行。

## 1. 前置条件

- macOS 12+（Monterey 及以上），已安装：
  - Node.js ≥ 20（`brew install node` 或官网安装包）
  - Xcode Command Line Tools：`xcode-select --install`
- 项目源码（含 `src/`、`build/icon.png`、`electron-builder.yml`、`package.json`）

## 2. 构建

```bash
cd js-pet
npm install          # 安装依赖（electron 二进制按当前平台自动下载）
npm run build:mac    # electron-builder --mac，产出 dmg（x64 + arm64）
```

产物位于 `dist/`：

| 文件 | 用途 |
|---|---|
| `js-pet-0.1.0-arm64.dmg` | Apple Silicon（M1/M2/M3/M4） |
| `js-pet-0.1.0-x64.dmg` | Intel Mac |
| 对应 `.blockmap` | 差量更新用（当前未启用自动更新，可忽略） |

如只需本机架构：`npx electron-builder --mac --arm64`。

## 3. 安装与首次打开（重要：Gatekeeper）

安装包**未做 Apple 签名与公证**（PRD v2.0 §14.3 / §17 已声明），首次打开会被 Gatekeeper 拦截，属预期行为：

1. 打开 dmg，把 **js-pet** 拖入「应用程序」。
2. 首次启动若提示“无法打开，因为无法验证开发者”：
   - 方法一：在 Finder 的「应用程序」中**右键 → 打开 → 再点打开**；
   - 方法二：「系统设置 → 隐私与安全性」底部点**仍要打开**。
3. 如被彻底拦截（ macOS Sequoia 对无签名应用更严格）：
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/js-pet.app
   ```

## 4. 签名与公证（可选，未包含在本版范围）

如需去除 Gatekeeper 告警，需要 Apple 开发者账号（$99/年）：

```bash
export CSC_LINK=<.p12 证书路径>
export CSC_KEY_PASSWORD=<证书密码>
export APPLE_ID=<Apple ID>
export APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
export APPLE_TEAM_ID=<团队 ID>
npx electron-builder --mac
```

并在 `electron-builder.yml` 的 `mac` 段补：

```yaml
mac:
  identity: <Developer ID Application: ...>
  notarize: true
  hardenedRuntime: true
  entitlements: build/entitlements.plist   # 需自行创建（默认继承即可）
```

## 5. 已知差异与注意事项

- `build/icon.png` 为 256×256（另有 512 的 `icon@2x.png`）。macOS 大图标建议 512+，若构建日志出现
  "icon should be at least 512x512" 警告，可将 `icon@2x.png` 复制覆盖 `icon.png` 后重新构建。
- `mac.identity: null` 已在配置中关闭强制签名（无证书也能构建）。
- 应用数据（形象/设置）存于 `~/Library/Application Support/js-pet/`，卸载 drag-to-trash 不会自动清除，如需彻底清理请手动删除该目录。

## 6. 验收清单（macOS 机器上执行）

- [ ] `npm run build:mac` 构建成功，`dist/` 出现 x64 与 arm64 两个 dmg
- [ ] 拖入应用程序后首次打开按 §3 放行成功
- [ ] 桌宠窗口正常显示、拖拽/右键菜单可用
- [ ] 退出后重新打开，配置保留
