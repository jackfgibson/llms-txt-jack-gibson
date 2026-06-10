"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HomeIcon, ListIcon, SparklesIcon, HelpCircleIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { Spinner } from "@/components/ui/spinner";
import { getPendingJobs, PENDING_JOBS_EVENT } from "@/lib/pending-jobs";

const NAV: Array<{
  label: string;
  href: string;
  icon: typeof HomeIcon;
  jobType?: "crawl" | "insight";
}> = [
  { label: "Generate", href: "/",        icon: HomeIcon },
  { label: "Results",  href: "/results",  icon: ListIcon,     jobType: "crawl" },
  { label: "Insights", href: "/insights", icon: SparklesIcon, jobType: "insight" },
  { label: "Why?",     href: "/why",      icon: HelpCircleIcon },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [activeJobs, setActiveJobs] = useState({ crawl: false, insight: false });

  useEffect(() => {
    function check() {
      const jobs = getPendingJobs();
      const crawl = jobs.some((j) => j.type === "crawl");
      const insight = jobs.some((j) => j.type === "insight");
      setActiveJobs((prev) =>
        prev.crawl === crawl && prev.insight === insight ? prev : { crawl, insight },
      );
    }
    // Initial read deferred a tick to keep the effect body setState-free.
    const initial = setTimeout(check, 0);
    // PENDING_JOBS_EVENT covers same-tab changes instantly; "storage" covers
    // other tabs; the interval catches removals done by pollers on other pages.
    const timer = setInterval(check, 2000);
    window.addEventListener(PENDING_JOBS_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener(PENDING_JOBS_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, []);

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Crawl Atlas"
              className="w-7 h-7 object-contain shrink-0"
              style={{ imageRendering: "pixelated" }}
            />
            <span className="text-sm font-semibold tracking-tight">Crawl Atlas</span>
          </Link>
          <ModeToggle />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ label, href, icon: Icon, jobType }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={pathname === href}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                    {jobType && activeJobs[jobType] && (
                      <Spinner className="ml-auto size-3.5 text-muted-foreground" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
