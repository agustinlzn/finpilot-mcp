import { spawn } from "node:child_process"

/**
 * Open a URL in the user's default browser.
 *
 * Hand-rolled rather than pulling in `open`: it is one `spawn` per platform, and
 * a login CLI that runs through `npx` should not carry a dependency tree for it.
 *
 * The URL is passed as a separate argv entry, never interpolated into a shell
 * string, so a crafted `verification_uri` cannot become command injection. On
 * Windows `start` is a `cmd` builtin and needs an empty title argument first,
 * otherwise a quoted URL is consumed as the window title.
 */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args] =
      process.platform === "darwin"
        ? (["open", [url]] as const)
        : process.platform === "win32"
          ? (["cmd", ["/c", "start", "", url]] as const)
          : (["xdg-open", [url]] as const)

    try {
      const child = spawn(command, [...args], {
        stdio: "ignore",
        detached: true,
      })
      child.on("error", () => resolve(false))
      child.unref()
      // A successful spawn does not guarantee a browser actually appeared, so
      // callers must always print the URL as a fallback regardless.
      setTimeout(() => resolve(true), 100)
    } catch {
      resolve(false)
    }
  })
}
