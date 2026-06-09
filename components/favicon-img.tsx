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
    <span
      className={`${cls} inline-flex items-center justify-center rounded-md shrink-0 p-px`}
      style={{ background: "radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.5) 100%)" }}
    >
      <img
        src={src}
        alt=""
        className="w-full h-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
