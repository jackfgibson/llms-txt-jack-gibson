"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => void };

export function ModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle() {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const doc = document as DocWithVT;
    if (doc.startViewTransition) {
      // Compositor-level cross-fade — immune to React re-render interference.
      doc.startViewTransition(() => setTheme(next));
    } else {
      // Firefox fallback: class-gated CSS transition.
      const root = document.documentElement;
      root.classList.add("is-theme-transitioning");
      setTheme(next);
      window.setTimeout(() => root.classList.remove("is-theme-transitioning"), 510);
    }
  }

  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggle}>
      <SunIcon className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
