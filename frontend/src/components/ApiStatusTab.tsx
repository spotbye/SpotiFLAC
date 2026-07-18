import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PlugZap, CheckCircle2, Loader2, Wrench, Server, Clock3 } from "lucide-react";
import { TidalIcon, QobuzIcon, AmazonIcon, DeezerIcon } from "./PlatformIcons";
import { useApiStatus } from "@/hooks/useApiStatus";
import { SPOTIFLAC_NEXT_SOURCES } from "@/lib/api-status";
import { openExternal } from "@/lib/utils";
type CommunityBreakStatus = {
    enabled: boolean;
    is_break: boolean;
    remaining_minutes: number;
    available: boolean;
    error?: string;
};
type CommunityBreakStatuses = Record<string, CommunityBreakStatus>;
const GetCommunityBreakStatuses = (): Promise<CommunityBreakStatuses> => (window as any)["go"]["main"]["App"]["GetCommunityBreakStatuses"]();
function renderBreakInfo(status: CommunityBreakStatus | undefined, loading: boolean) {
    if (loading && !status) {
        return <span className="text-xs text-muted-foreground">Loading schedule...</span>;
    }
    if (!status?.available) {
        return <span className="text-xs text-muted-foreground">Break schedule unavailable</span>;
    }
    if (!status.enabled) {
        return <span className="text-xs text-muted-foreground">Scheduled break disabled</span>;
    }
    return (<span className="text-xs text-muted-foreground">
      {status.is_break ? `Break ends in ${status.remaining_minutes} min` : `Break starts in ${status.remaining_minutes} min`}
    </span>);
}
function renderStatusIndicator(status: "checking" | "online" | "offline" | "idle") {
    if (status === "online") {
        return <CheckCircle2 className="h-5 w-5 text-emerald-500"/>;
    }
    if (status === "offline") {
        return <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400"/>;
    }
    return null;
}
function renderPlatformIcon(type: string) {
    if (type === "tidal") {
        return <TidalIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "amazon") {
        return <AmazonIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    if (type === "deezer") {
        return <DeezerIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
    }
    return <QobuzIcon className="w-5 h-5 shrink-0 text-muted-foreground"/>;
}
export function ApiStatusTab() {
    const { sources, statuses, nextStatuses, checkingSources, checkAllCurrent, checkAllNext } = useApiStatus();
    const isCheckingCurrent = sources.some((source) => checkingSources[source.id] === true);
    const isCheckingNext = SPOTIFLAC_NEXT_SOURCES.some((source) => nextStatuses[source.id] === "checking");
    const isChecking = isCheckingCurrent || isCheckingNext;
    const [breakStatuses, setBreakStatuses] = useState<CommunityBreakStatuses>({});
    const [isCheckingBreaks, setIsCheckingBreaks] = useState(false);
    const checkBreaks = useCallback(async () => {
        setIsCheckingBreaks(true);
        try {
            setBreakStatuses(await GetCommunityBreakStatuses());
        }
        catch {
            setBreakStatuses({});
        }
        finally {
            setIsCheckingBreaks(false);
        }
    }, []);
    useEffect(() => {
        void checkBreaks();
    }, [checkBreaks]);
    const checkAll = () => {
        void checkAllCurrent();
        void checkAllNext();
        void checkBreaks();
    };
    return (<div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight">SpotiFLAC</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openExternal("https://spotbye.qzz.io")} className="gap-2">
              <Server className="h-4 w-4"/>
              Details
            </Button>
            <Button variant="outline" size="sm" onClick={checkAll} disabled={isChecking || isCheckingBreaks} className="gap-2">
              {isChecking || isCheckingBreaks ? <Loader2 className="h-4 w-4 animate-spin"/> : <PlugZap className="h-4 w-4"/>}
              Check
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map((source) => {
            const status = statuses[source.id] || "idle";
            return (<div key={source.id} className="space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {renderPlatformIcon(source.type)}
                    <p className="font-medium leading-none">{source.name}</p>
                  </div>
                  <div className="flex items-center">{renderStatusIndicator(status)}</div>
                </div>
                <div className="flex items-center gap-2 border-t pt-3">
                  <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
                  {renderBreakInfo(breakStatuses[source.id], isCheckingBreaks)}
                </div>
              </div>);
        })}
        </div>
        <p className="text-xs text-muted-foreground">
          *The servers are available for about 1 hour after each scheduled break.
        </p>
      </div>

      <div className="border-t"/>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight">SpotiFLAC Next</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SPOTIFLAC_NEXT_SOURCES.map((source) => {
            const status = nextStatuses[source.id] || "idle";
            return (<div key={source.id} className="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-3">
                {renderPlatformIcon(source.id)}
                <p className="font-medium leading-none">{source.name}</p>
              </div>
              <div className="flex items-center">{renderStatusIndicator(status)}</div>
            </div>);
        })}
        </div>
      </div>
    </div>);
}
