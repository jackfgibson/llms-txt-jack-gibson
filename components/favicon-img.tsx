"use client";

import { useState } from "react";

export function FaviconImg({
  src,
  size = "sm",
}: {
  src: string | null;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);

  const cls = size === "md" ? "w-5 h-5 text-base" : "w-4 h-4 text-sm";

  if (!src || failed) {
    return (
      <span className={`${cls} inline-flex items-center justify-center shrink-0 leading-none select-none`}>
        🌐
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`${cls} rounded-sm object-contain shrink-0`}
      onError={() => setFailed(true)}
    />
  );
}
