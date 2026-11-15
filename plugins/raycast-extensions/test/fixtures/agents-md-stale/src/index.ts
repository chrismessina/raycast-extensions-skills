import { Clipboard, showHUD } from "@raycast/api";

export default async function Command() {
  await Clipboard.copy("Hello");
  await showHUD("Copied Greeting");
}
