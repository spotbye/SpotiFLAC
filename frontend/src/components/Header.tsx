import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { openExternal } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
interface HeaderProps {
    version: string;
    hasUpdate: boolean;
    releaseDate?: string | null;
}
export function Header({ version, hasUpdate, releaseDate }: HeaderProps) {
    return (<div className="relative">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <button type="button" className="cursor-pointer rounded-sm border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => window.location.reload()} aria-label="Reload SpotiFLAC">
            <img src="/icon.svg" alt="" className="w-12 h-12"/>
          </button>
          <h1 className="text-4xl font-bold">
            <button type="button" className="cursor-pointer rounded-sm border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => window.location.reload()}>
              SpotiFLAC
            </button>
          </h1>
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="default" asChild>
                  <button type="button" onClick={() => openExternal("https://github.com/spotbye/SpotiFLAC/releases/latest")} className="cursor-pointer hover:opacity-80 transition-opacity">
                    v{version}
                  </button>
                </Badge>
              </TooltipTrigger>
              {hasUpdate && releaseDate && (<TooltipContent>
                  <p>{formatRelativeTime(releaseDate)}</p>
                </TooltipContent>)}
            </Tooltip>
            {hasUpdate && (<span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>)}
          </div>
        </div>
        <p className="text-muted-foreground">
          Get Spotify tracks in true FLAC from Tidal, Qobuz & Amazon Music — no account required.
        </p>
      </div>
    </div>);
}
