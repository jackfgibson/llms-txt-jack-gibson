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
  const backdropCls = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

  if (!src || failed) {
    return (
      <span className={`${cls} inline-flex items-center justify-center shrink-0 leading-none select-none`}>
        🌐
      </span>
    );
  }

  return (
    <span className={`${cls} inline-flex items-center justify-center shrink-0`}>
      <span className={`${backdropCls} inline-flex items-center justify-center rounded-[4px] bg-white`}>
        <img
          src={src}
          alt=""
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    </span>
  );
}
