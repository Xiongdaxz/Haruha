# Platform Support

English | [简体中文](../zh-CN/platform-support.md)

| Capability | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Read system proxy | Yes | Yes | GNOME-family desktops |
| Write HTTP/HTTPS manual proxy | Yes | Yes | GNOME-family desktops |
| PAC Auto Proxy URL | Yes | Yes | GNOME-family desktops |
| Bypass list | Yes | Yes | GNOME-family desktops |
| Tray panel | Implemented and verified | Capability currently reports false | Capability currently reports false |
| Packaging evidence | EXE/MSI | No formal `.app`/`.dmg` evidence | No formal package evidence |

## Windows

Uses the current user's `Internet Settings` registry values and WinINet refresh calls. The main development and packaging paths have run on Windows; every public version must still be revalidated on a clean machine as described in the release guide.

## macOS

The source uses `networksetup` to enumerate network services and write Web Proxy, Secure Web Proxy, and Auto Proxy URL settings. Before formal support, test permission behavior, Wi-Fi/Ethernet switching, PAC retrieval, restart, disable/exit, force-termination recovery, and whether target applications honor system settings on a real Mac. The current implementation configures HTTP/HTTPS, not SOCKS.

## Linux

The source uses `gsettings` for GNOME, Cinnamon, and Unity. KDE and unknown desktops return limitation messages and must not report false success. Formal support requires real validation on each target distribution, desktop session, permission model, proxy format, PAC flow, restart, and recovery.

## Common limitations

- System proxy settings affect only applications that honor them.
- Manual mode cannot represent every CIDR or URL-wildcard semantic available in PAC mode.
- Traffic overview covers all network interfaces, not proxy-only traffic.
- A force-killed process cannot guarantee proxy restoration.
