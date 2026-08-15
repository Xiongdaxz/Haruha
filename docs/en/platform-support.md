# Platform Support

English | [简体中文](../zh-CN/platform-support.md)

| Capability | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Read system proxy | Yes | Yes | GNOME-family desktops |
| Write HTTP/HTTPS manual proxy | Yes | Yes | GNOME-family desktops |
| PAC Auto Proxy URL | Yes | Yes | GNOME-family desktops |
| Bypass list | Yes | Yes | GNOME-family desktops |
| Live physical-interface traffic | Yes | Not supported yet | Not supported yet |
| Per-application session totals | Yes, with UAC | Not supported yet | Not supported yet |
| Tray panel | Implemented and verified | Capability currently reports false | Capability currently reports false |
| Packaging evidence | EXE/MSI | No formal `.app`/`.dmg` evidence | No formal package evidence |

## Windows

Uses the current user's `Internet Settings` registry values and WinINet refresh calls. The first application-traffic start in each Haruha process launches a UAC-elevated helper. Disabling monitoring stops ETW but retains that helper idle, so later starts in the same process do not prompt again. Collection covers TCP/UDP and IPv4/IPv6, excludes loopback traffic, and merges processes by executable. The main development and packaging paths have run on Windows; every public version must still revalidate UAC cancellation, collector failure, repeated stop/start, sleep/resume, and application-exit cleanup on a clean machine.

## macOS

The source uses `networksetup` to enumerate network services and write Web Proxy, Secure Web Proxy, and Auto Proxy URL settings. Before formal support, test permission behavior, Wi-Fi/Ethernet switching, PAC retrieval, restart, disable/exit, force-termination recovery, and whether target applications honor system settings on a real Mac. The current implementation configures HTTP/HTTPS, not SOCKS.

## Linux

The source uses `gsettings` for GNOME, Cinnamon, and Unity. KDE and unknown desktops return limitation messages and must not report false success. Formal support requires real validation on each target distribution, desktop session, permission model, proxy format, PAC flow, restart, and recovery.

## Common limitations

- System proxy settings affect only applications that honor them.
- Manual mode cannot represent every CIDR or URL-wildcard semantic available in PAC mode.
- Traffic overview covers active physical interfaces, not proxy-only traffic; virtual and loopback adapters are excluded.
- macOS and Linux do not yet support either the system-interface chart or per-application breakdown.
- Windows application totals are in-memory values for the current monitoring session only; there are no per-application live rates or historical records.
- A force-killed process cannot guarantee proxy restoration.
