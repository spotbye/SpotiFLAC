import { useEffect, useState } from "react";
import { openExternal } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card";
import { Star, GitFork, Clock, Download, Info } from "lucide-react";
import AudioTTSProIcon from "@/assets/audiotts-pro.webp";
import XIcon from "@/assets/x.webp";
import SpotubeDLIcon from "@/assets/icons/spotubedl.svg";
import XBatchDLIcon from "@/assets/icons/xbatchdl.svg";
import SpotiFLACNextIcon from "@/assets/icons/next.svg";
import { langColors } from "@/assets/github-lang-colors";
const browserExtensionItems = [
    { icon: XIcon, label: "Twitter/X Media Batch Downloader", alt: "Twitter/X Media Batch Downloader" },
    { icon: AudioTTSProIcon, label: "AudioTTS Pro", alt: "AudioTTS Pro" },
];
const projectCardClass = "cursor-pointer gap-3 py-5 transition-colors hover:bg-muted/50 dark:hover:bg-accent/50";
const projectCardHeaderClass = "px-5 gap-1.5";
const projectCardContentClass = "px-5";
const projectBodyClass = "text-[13px] leading-snug";
const releaseMetaClass = "text-xs text-muted-foreground whitespace-nowrap";
const releaseVersionClass = "text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-sm font-mono font-semibold whitespace-nowrap";
export function OtherProjects() {
    const [repoStats, setRepoStats] = useState<Record<string, any>>({});
    useEffect(() => {
        const fetchRepoStats = async () => {
            const CACHE_KEY = "github_repo_stats_v4";
            const CACHE_DURATION = 1000 * 60 * 60;
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < CACHE_DURATION) {
                        setRepoStats(data);
                        return;
                    }
                }
                catch (err) {
                    console.error("Failed to parse cache:", err);
                }
            }
            const repos = [
                { name: "SpotiFLAC-Next", owner: "spotbye" },
                { name: "Twitter-X-Media-Batch-Downloader", owner: "afkarxyz" },
            ];
            const stats: Record<string, any> = {};
            for (const repo of repos) {
                try {
                    const [repoRes, releasesRes, langsRes] = await Promise.all([
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`),
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/releases`),
                        fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/languages`),
                    ]);
                    if (repoRes.status === 403) {
                        if (cached) {
                            const { data } = JSON.parse(cached);
                            setRepoStats(data);
                        }
                        return;
                    }
                    if (repoRes.ok) {
                        const repoData = await repoRes.json();
                        const releases = releasesRes.ok ? await releasesRes.json() : [];
                        const languages = langsRes.ok ? await langsRes.json() : {};
                        let totalDownloads = 0;
                        let latestDownloads = 0;
                        let latestVersion = "";
                        let latestReleaseAt = "";
                        if (releases.length > 0) {
                            latestVersion = releases[0].tag_name || "";
                            latestReleaseAt = releases[0].published_at || releases[0].created_at || "";
                            latestDownloads =
                                releases[0].assets?.reduce((sum: number, asset: any) => sum + (asset.download_count || 0), 0) || 0;
                            totalDownloads = releases.reduce((sum: number, release: any) => {
                                return (sum +
                                    (release.assets?.reduce((s: number, a: any) => s + (a.download_count || 0), 0) || 0));
                            }, 0);
                        }
                        const topLangs = Object.entries(languages)
                            .sort(([, a]: any, [, b]: any) => b - a)
                            .slice(0, 4)
                            .map(([lang]) => lang);
                        stats[repo.name] = {
                            stars: repoData.stargazers_count,
                            forks: repoData.forks_count,
                            createdAt: repoData.created_at,
                            description: repoData.description,
                            totalDownloads,
                            latestDownloads,
                            latestVersion,
                            latestReleaseAt,
                            languages: topLangs,
                        };
                    }
                }
                catch (err) {
                    console.error(`Failed to fetch stats for ${repo.name}:`, err);
                    if (cached) {
                        const { data } = JSON.parse(cached);
                        setRepoStats(data);
                        return;
                    }
                }
            }
            setRepoStats(stats);
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: stats, timestamp: Date.now() }));
        };
        fetchRepoStats();
    }, []);
    const formatTimeAgo = (dateString: string): string => {
        const now = new Date();
        const updated = new Date(dateString);
        const diffMs = now.getTime() - updated.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffMonths = Math.floor(diffDays / 30);
        if (diffDays === 0)
            return "today";
        if (diffDays === 1)
            return "1d";
        if (diffDays < 30)
            return `${diffDays}d`;
        if (diffMonths === 1)
            return "1mo";
        if (diffMonths < 12)
            return `${diffMonths}mo`;
        const diffYears = Math.floor(diffMonths / 12);
        return `${diffYears}y`;
    };
    const formatReleaseTimeAgo = (dateString: string): string => {
        if (!dateString) {
            return "";
        }
        const now = Date.now();
        const releasedAt = new Date(dateString).getTime();
        if (Number.isNaN(releasedAt)) {
            return "";
        }
        const diffMs = Math.max(0, now - releasedAt);
        const totalMinutes = Math.floor(diffMs / (1000 * 60));
        const totalHours = Math.floor(totalMinutes / 60);
        const totalDays = Math.floor(totalHours / 24);
        const totalMonths = Math.floor(totalDays / 30);
        const totalYears = Math.floor(totalMonths / 12);
        if (totalYears > 0) {
            const remainingMonths = totalMonths % 12;
            return remainingMonths > 0 ? `${totalYears}y ${remainingMonths}m ago` : `${totalYears}y ago`;
        }
        if (totalMonths > 0) {
            const remainingDays = totalDays % 30;
            return remainingDays > 0 ? `${totalMonths}m ${remainingDays}d ago` : `${totalMonths}m ago`;
        }
        if (totalDays > 0) {
            const remainingHours = totalHours % 24;
            return remainingHours > 0 ? `${totalDays}d ${remainingHours}h ago` : `${totalDays}d ago`;
        }
        if (totalHours > 0) {
            const remainingMinutes = totalMinutes % 60;
            return `${totalHours}h ${remainingMinutes}m ago`;
        }
        return `${totalMinutes}m ago`;
    };
    const formatNumber = (num: number): string => {
        if (num >= 1000) {
            return num.toLocaleString();
        }
        return num.toString();
    };
    const getLangColor = (lang: string): string => {
        return langColors[lang] || "#858585";
    };
    const getRepoDescription = (repoName: string): string => {
        return repoStats[repoName]?.description || "";
    };
    return (<div className="flex flex-col space-y-3">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-2xl font-bold tracking-tight">Other Projects</h2>
      </div>

      <div className="flex-1 min-h-0 pr-1.5">
            <div className="grid gap-2 grid-cols-3">
              <Card className={projectCardClass} onClick={() => openExternal("https://github.com/spotbye/SpotiFLAC-Next")}>
                <CardHeader className={projectCardHeaderClass}>
                  <div className="flex justify-between items-start mb-2">
                    <img src={SpotiFLACNextIcon} className="h-6 w-6 shrink-0" alt="SpotiFLAC Next"/>
                    <div className="ml-3 flex flex-wrap items-center justify-end gap-2">
                      {repoStats["SpotiFLAC-Next"]?.latestReleaseAt && (<span className={releaseMetaClass}>
                          {formatReleaseTimeAgo(repoStats["SpotiFLAC-Next"].latestReleaseAt)}
                        </span>)}
                      {repoStats["SpotiFLAC-Next"]?.latestVersion && (<span className={releaseVersionClass}>
                          {repoStats["SpotiFLAC-Next"].latestVersion}
                        </span>)}
                    </div>
                  </div>
                  <CardTitle className="leading-tight">
                    SpotiFLAC Next
                  </CardTitle>
                  <CardDescription className={projectBodyClass}>
                    {getRepoDescription("SpotiFLAC-Next")}
                  </CardDescription>
                </CardHeader>
                {repoStats["SpotiFLAC-Next"] && (<CardContent className={`${projectCardContentClass} space-y-2`}>
                    {repoStats["SpotiFLAC-Next"].languages?.length > 0 && (<div className="flex flex-wrap gap-2 text-xs">
                        {repoStats["SpotiFLAC-Next"].languages.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: getLangColor(lang) + "20",
                        color: getLangColor(lang),
                    }}>
                            {lang}
                          </span>))}
                      </div>)}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/>{" "}
                        {formatNumber(repoStats["SpotiFLAC-Next"].stars)}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="h-3.5 w-3.5"/>{" "}
                        {repoStats["SpotiFLAC-Next"].forks}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5"/>{" "}
                        {formatTimeAgo(repoStats["SpotiFLAC-Next"].createdAt)}
                      </span>
                    </div>
                    <div className="rounded-md border border-sky-500/25 bg-sky-500/8 px-3 py-2">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                        <Info className="h-3.5 w-3.5"/>
                        Note
                      </div>
                      <p className="text-xs leading-snug text-sky-700 dark:text-sky-300">
                        This project is shared as a thank-you to those who support SpotiFLAC. It is not a paid product or something being sold, but a complimentary gift available through a private supporter post.
                      </p>
                    </div>
                  </CardContent>)}
              </Card>
              <Card className={projectCardClass} onClick={() => openExternal("https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader")}>
                <CardHeader className={projectCardHeaderClass}>
                  <div className="flex justify-between items-start mb-2">
                    <img src={XBatchDLIcon} className="h-6 w-6 shrink-0" alt="Twitter/X Media Batch Downloader"/>
                    <div className="ml-3 flex flex-wrap items-center justify-end gap-2">
                      {repoStats["Twitter-X-Media-Batch-Downloader"]?.latestReleaseAt && (<span className={releaseMetaClass}>
                          {formatReleaseTimeAgo(repoStats["Twitter-X-Media-Batch-Downloader"].latestReleaseAt)}
                        </span>)}
                      {repoStats["Twitter-X-Media-Batch-Downloader"]?.latestVersion && (<span className={releaseVersionClass}>
                          {repoStats["Twitter-X-Media-Batch-Downloader"].latestVersion}
                        </span>)}
                    </div>
                  </div>
                  <CardTitle className="leading-tight">
                    Twitter/X Media Batch Downloader
                  </CardTitle>
                  <CardDescription className={projectBodyClass}>
                    {getRepoDescription("Twitter-X-Media-Batch-Downloader")}
                  </CardDescription>
                </CardHeader>
                {repoStats["Twitter-X-Media-Batch-Downloader"] && (<CardContent className={`${projectCardContentClass} space-y-2`}>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {repoStats["Twitter-X-Media-Batch-Downloader"].languages?.map((lang: string) => (<span key={lang} className="px-2 py-0.5 rounded-full font-medium" style={{
                    backgroundColor: getLangColor(lang) + "20",
                    color: getLangColor(lang),
                }}>
                          {lang}
                        </span>))}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/>{" "}
                        {formatNumber(repoStats["Twitter-X-Media-Batch-Downloader"].stars)}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="h-3.5 w-3.5"/>{" "}
                        {repoStats["Twitter-X-Media-Batch-Downloader"].forks}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5"/>{" "}
                        {formatTimeAgo(repoStats["Twitter-X-Media-Batch-Downloader"]
                .createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground items-start">
                      <span className="flex items-center gap-1">
                        <Download className="h-3.5 w-3.5"/> TOTAL:{" "}
                        {formatNumber(repoStats["Twitter-X-Media-Batch-Downloader"]
                .totalDownloads)}
                      </span>
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Download className="h-3.5 w-3.5"/> LATEST:{" "}
                        {formatNumber(repoStats["Twitter-X-Media-Batch-Downloader"]
                .latestDownloads)}
                      </span>
                    </div>
                  </CardContent>)}
              </Card>
              <div className="flex h-full flex-col gap-1.5">
                <Card className={`${projectCardClass} flex-1`} onClick={() => openExternal("https://exyezed.fyi/")}>
                    <CardHeader className={projectCardHeaderClass}>
                    <CardTitle className="leading-tight">Browser Extensions & Scripts</CardTitle>
                    <CardDescription className="flex flex-col gap-2.5 pt-1.5">
                      {browserExtensionItems.map((item) => (<div key={item.alt} className="flex items-center gap-2.5">
                          <img src={item.icon} className="h-5.5 w-5.5 rounded-sm shadow-sm" alt={item.alt}/>
                          <span className={`${projectBodyClass} text-muted-foreground`}>
                            {item.label}
                          </span>
                        </div>))}
                    </CardDescription>
                  </CardHeader>
                </Card>
                <Card className={`${projectCardClass} flex-1`} onClick={() => openExternal("https://spotubedl.com/")}>
                  <CardHeader className={projectCardHeaderClass}>
                    <CardTitle className="flex items-center gap-2 leading-tight">
                      <img src={SpotubeDLIcon} className="h-5 w-5" alt="SpotubeDL"/>{" "}
                      SpotubeDL.com
                    </CardTitle>
                    <CardDescription className={projectBodyClass}>
                      Download Spotify Tracks, Albums, Playlists & Discography as MP3/OGG/Opus.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            </div>
      </div>
    </div>);
}
