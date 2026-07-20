import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleColorMode, useColorMode } from "@/theme/colorMode";

/** One-click theme switch: dark ⇄ light, persisted, no menus. */
export function ThemeToggle() {
  const dark = useColorMode() === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleColorMode}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
    </Button>
  );
}
