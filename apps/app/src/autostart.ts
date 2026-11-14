// "Open Beamhop when I log in": local agents come back when the app starts, so starting the app at login keeps
// them running after a reboot. One small file in the OS's per-user login items; nothing system-wide.
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

function command(): string[] {
  // Compiled app: the binary itself. Development: bun + the entry script.
  const exe = process.execPath;
  const script = Bun.argv[1];
  return /bun(\.exe)?$/i.test(exe) && script ? [exe, script] : [exe];
}

function file(home = homedir()): string {
  if (process.platform === "darwin") return `${home}/Library/LaunchAgents/com.beamhop.app.plist`;
  if (process.platform === "win32") return `${process.env.APPDATA ?? `${home}/AppData/Roaming`}/Microsoft/Windows/Start Menu/Programs/Startup/Beamhop.cmd`;
  return `${process.env.XDG_CONFIG_HOME ?? `${home}/.config`}/autostart/beamhop.desktop`;
}

export async function autostartEnabled(home?: string) {
  return Bun.file(file(home)).exists();
}

export async function setAutostart(on: boolean, home?: string) {
  const f = file(home);
  if (!on) return rm(f, { force: true });
  const cmd = command();
  await mkdir(dirname(f), { recursive: true });
  if (process.platform === "darwin") {
    const args = cmd.map((a) => `<string>${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`).join("");
    await Bun.write(f, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.beamhop.app</string><key>ProgramArguments</key><array>${args}</array><key>RunAtLoad</key><true/></dict></plist>\n`);
  } else if (process.platform === "win32") {
    await Bun.write(f, `@echo off\r\nstart "" ${cmd.map((a) => `"${a}"`).join(" ")}\r\n`);
  } else {
    const exec = cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
    await Bun.write(f, `[Desktop Entry]\nType=Application\nName=Beamhop\nComment=Your agents, back after a restart\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`);
  }
}
