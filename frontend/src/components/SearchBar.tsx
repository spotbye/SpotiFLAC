import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithContext } from "@/components/ui/input-with-context";
import { CloudDownload, XCircle, Search, X, ChevronDown, ArrowUpDown, Clipboard, ExternalLink, } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { FetchHistory } from "@/components/FetchHistory";
import type { HistoryItem } from "@/components/FetchHistory";
import { SearchSpotify, SearchSpotifyByType } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";
import { cn } from "@/lib/utils";
import { useTypingEffect } from "@/hooks/useTypingEffect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { openExternal } from "@/lib/utils";
const SMART_PLACEHOLDERS = [
    "Taylor Swift",
    "Die For You",
    "https://open.spotify.com/track/...",
    "https://open.spotify.com/album/...",
    "https://open.spotify.com/playlist/...",
    "https://open.spotify.com/artist/...",
];
type ResultTab = "tracks" | "albums" | "artists" | "playlists";
type SmartInputKind = "empty" | "spotify" | "search" | "next-url" | "invalid-url";
type NextProvider = "Tidal" | "Deezer" | "Amazon Music" | "Qobuz";
const RECENT_SEARCHES_KEY = "spotiflac_recent_searches";
const MAX_RECENT_SEARCHES = 8;
const SEARCH_LIMIT = 50;
const SPOTIFLAC_NEXT_URL = "https://github.com/spotbye/SpotiFLAC-Next";
function getNextProvider(hostname: string): NextProvider | null {
    if (hostname === "tidal.com" || hostname.endsWith(".tidal.com"))
        return "Tidal";
    if (hostname === "deezer.com" || hostname.endsWith(".deezer.com"))
        return "Deezer";
    if (hostname.startsWith("music.amazon."))
        return "Amazon Music";
    if (hostname === "qobuz.com" || hostname.endsWith(".qobuz.com"))
        return "Qobuz";
    return null;
}
function parseSmartUrl(value: string): URL | null {
    try {
        return new URL(/^www\./i.test(value) ? `https://${value}` : value);
    }
    catch {
        return null;
    }
}
function classifySmartInput(value: string): SmartInputKind {
    const trimmed = value.trim();
    if (!trimmed) {
        return "empty";
    }
    if (/^spotify:/i.test(trimmed)) {
        return "spotify";
    }
    const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(trimmed);
    if (!looksLikeUrl) {
        return "search";
    }
    const parsedUrl = parseSmartUrl(trimmed);
    if (!parsedUrl) {
        return "invalid-url";
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === "spotify.com" || hostname.endsWith(".spotify.com") || hostname === "spotify.link" || hostname.endsWith(".spotify.link"))
        return "spotify";
    return getNextProvider(hostname) ? "next-url" : "invalid-url";
}
interface SearchBarProps {
    url: string;
    loading: boolean;
    onUrlChange: (url: string) => void;
    onFetch: () => void;
    onFetchUrl: (url: string) => Promise<void>;
    history: HistoryItem[];
    onHistorySelect: (item: HistoryItem) => void;
    onHistoryRemove: (id: string) => void;
    hasResult: boolean;
    onSearchModeChange: (isSearch: boolean) => void;
}
export function SearchBar({ url, loading, onUrlChange, onFetch, onFetchUrl, history, onHistorySelect, onHistoryRemove, hasResult, onSearchModeChange, }: SearchBarProps) {
    const [searchResults, setSearchResults] = useState<backend.SearchResponse | null>(null);
    const [resultFilter, setResultFilter] = useState("");
    const [sortOrders, setSortOrders] = useState<Record<ResultTab, string>>({
        tracks: "default",
        albums: "default",
        artists: "default",
        playlists: "default",
    });
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [lastSearchedQuery, setLastSearchedQuery] = useState("");
    const [activeTab, setActiveTab] = useState<ResultTab>("tracks");
    const [recentSearches, setRecentSearches] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
            return saved ? JSON.parse(saved) : [];
        }
        catch (error) {
            console.error("Failed to load recent searches:", error);
            return [];
        }
    });
    const [hasMore, setHasMore] = useState<Record<ResultTab, boolean>>({
        tracks: false,
        albums: false,
        artists: false,
        playlists: false,
    });
    const [showInvalidUrlDialog, setShowInvalidUrlDialog] = useState(false);
    const [showNextDialog, setShowNextDialog] = useState(false);
    const [nextProvider, setNextProvider] = useState<NextProvider | null>(null);
    const [invalidUrl, setInvalidUrl] = useState("");
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRequestRef = useRef(0);
    const nextDialogPromptedRef = useRef(false);
    const inputKind = classifySmartInput(url);
    const isSearchInput = inputKind === "search";
    const placeholderText = useTypingEffect(SMART_PLACEHOLDERS);
    useEffect(() => {
        onSearchModeChange(isSearchInput);
    }, [isSearchInput, onSearchModeChange]);
    const saveRecentSearch = (query: string) => {
        const trimmed = query.trim();
        if (!trimmed)
            return;
        setRecentSearches((prev) => {
            const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
            const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
            try {
                localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
            }
            catch (error) {
                console.error("Failed to save recent searches:", error);
            }
            return updated;
        });
    };
    const removeRecentSearch = (query: string) => {
        setRecentSearches((prev) => {
            const updated = prev.filter((s) => s !== query);
            try {
                localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
            }
            catch (error) {
                console.error("Failed to save recent searches:", error);
            }
            return updated;
        });
    };
    const handleSmartInputChange = (value: string) => {
        const nextKind = classifySmartInput(value);
        searchRequestRef.current += 1;
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        setSearchResults(null);
        setLastSearchedQuery("");
        setResultFilter("");
        setIsSearching(nextKind === "search");
        onUrlChange(value);
        if (nextKind === "next-url" && !nextDialogPromptedRef.current) {
            const parsedUrl = parseSmartUrl(value.trim());
            setInvalidUrl(value.trim());
            setNextProvider(parsedUrl ? getNextProvider(parsedUrl.hostname.toLowerCase()) : null);
            setShowNextDialog(true);
            nextDialogPromptedRef.current = true;
        }
        else if (nextKind !== "next-url") {
            nextDialogPromptedRef.current = false;
        }
    };
    useEffect(() => {
        if (!isSearchInput || !url.trim()) {
            searchRequestRef.current += 1;
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
            return;
        }
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        searchTimeoutRef.current = setTimeout(async () => {
            const requestId = ++searchRequestRef.current;
            setIsSearching(true);
            try {
                const results = await SearchSpotify({
                    query: url,
                    limit: SEARCH_LIMIT,
                });
                if (requestId !== searchRequestRef.current) {
                    return;
                }
                setSearchResults(results);
                setResultFilter("");
                setLastSearchedQuery(url.trim());
                saveRecentSearch(url.trim());
                setHasMore({
                    tracks: results.tracks.length === SEARCH_LIMIT,
                    albums: results.albums.length === SEARCH_LIMIT,
                    artists: results.artists.length === SEARCH_LIMIT,
                    playlists: results.playlists.length === SEARCH_LIMIT,
                });
                if (results.tracks.length > 0)
                    setActiveTab("tracks");
                else if (results.albums.length > 0)
                    setActiveTab("albums");
                else if (results.artists.length > 0)
                    setActiveTab("artists");
                else if (results.playlists.length > 0)
                    setActiveTab("playlists");
            }
            catch (error) {
                if (requestId !== searchRequestRef.current) {
                    return;
                }
                console.error("Search failed:", error);
                setSearchResults(null);
            }
            finally {
                if (requestId === searchRequestRef.current) {
                    setIsSearching(false);
                }
            }
        }, 400);
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [url, isSearchInput]);
    const handleLoadMore = async () => {
        if (!searchResults || !lastSearchedQuery || isLoadingMore)
            return;
        const typeMap: Record<ResultTab, string> = {
            tracks: "track",
            albums: "album",
            artists: "artist",
            playlists: "playlist",
        };
        const currentCount = getTabCount(activeTab);
        setIsLoadingMore(true);
        try {
            const moreResults = await SearchSpotifyByType({
                query: lastSearchedQuery,
                search_type: typeMap[activeTab],
                limit: SEARCH_LIMIT,
                offset: currentCount,
            });
            if (moreResults.length > 0) {
                setSearchResults((prev) => {
                    if (!prev)
                        return prev;
                    const updated = new backend.SearchResponse({
                        tracks: activeTab === "tracks"
                            ? [...prev.tracks, ...moreResults]
                            : prev.tracks,
                        albums: activeTab === "albums"
                            ? [...prev.albums, ...moreResults]
                            : prev.albums,
                        artists: activeTab === "artists"
                            ? [...prev.artists, ...moreResults]
                            : prev.artists,
                        playlists: activeTab === "playlists"
                            ? [...prev.playlists, ...moreResults]
                            : prev.playlists,
                    });
                    return updated;
                });
            }
            setHasMore((prev) => ({
                ...prev,
                [activeTab]: moreResults.length === SEARCH_LIMIT,
            }));
        }
        catch (error) {
            console.error("Load more failed:", error);
        }
        finally {
            setIsLoadingMore(false);
        }
    };
    const handleFetchWithValidation = () => {
        if (inputKind === "next-url") {
            const parsedUrl = parseSmartUrl(url.trim());
            setInvalidUrl(url.trim());
            setNextProvider(parsedUrl ? getNextProvider(parsedUrl.hostname.toLowerCase()) : null);
            setShowNextDialog(true);
            return;
        }
        if (inputKind === "invalid-url") {
            setInvalidUrl(url);
            setShowInvalidUrlDialog(true);
            return;
        }
        if (inputKind === "spotify") {
            onFetch();
        }
    };
    const handleClipboardPaste = async () => {
        try {
            const clipboardText = (await navigator.clipboard.readText()).trim();
            if (clipboardText) {
                handleSmartInputChange(clipboardText);
            }
        }
        catch (error) {
            console.error("Failed to read clipboard:", error);
        }
    };
    const handleResultClick = (externalUrl: string) => {
        handleSmartInputChange(externalUrl);
        onSearchModeChange(false);
        void onFetchUrl(externalUrl);
    };
    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };
    const hasAnyResults = searchResults &&
        (searchResults.tracks.length > 0 ||
            searchResults.albums.length > 0 ||
            searchResults.artists.length > 0 ||
            searchResults.playlists.length > 0);
    const getTabCount = (tab: ResultTab): number => {
        if (!searchResults)
            return 0;
        switch (tab) {
            case "tracks":
                return searchResults.tracks.length;
            case "albums":
                return searchResults.albums.length;
            case "artists":
                return searchResults.artists.length;
            case "playlists":
                return searchResults.playlists.length;
        }
    };
    const sortedResults = useMemo(() => {
        if (!searchResults)
            return { tracks: [], albums: [], artists: [], playlists: [] };
        const filterStr = resultFilter.toLowerCase();
        let tracks = [...searchResults.tracks];
        if (filterStr) {
            tracks = tracks.filter(t => (t.name || '').toLowerCase().includes(filterStr) || (t.artists || '').toLowerCase().includes(filterStr));
        }
        const tSort = sortOrders.tracks;
        if (tSort !== 'default') {
            tracks.sort((a, b) => {
                if (tSort === 'title-asc')
                    return (a.name || '').localeCompare(b.name || '');
                if (tSort === 'title-desc')
                    return (b.name || '').localeCompare(a.name || '');
                if (tSort === 'artist-asc')
                    return (a.artists || '').localeCompare(b.artists || '');
                if (tSort === 'artist-desc')
                    return (b.artists || '').localeCompare(a.artists || '');
                if (tSort === 'duration-desc')
                    return (b.duration_ms || 0) - (a.duration_ms || 0);
                if (tSort === 'duration-asc')
                    return (a.duration_ms || 0) - (b.duration_ms || 0);
                return 0;
            });
        }
        let albums = [...searchResults.albums];
        if (filterStr) {
            albums = albums.filter(a => (a.name || '').toLowerCase().includes(filterStr) || (a.artists || '').toLowerCase().includes(filterStr));
        }
        const alSort = sortOrders.albums;
        if (alSort !== 'default') {
            albums.sort((a, b) => {
                if (alSort === 'title-asc')
                    return (a.name || '').localeCompare(b.name || '');
                if (alSort === 'title-desc')
                    return (b.name || '').localeCompare(a.name || '');
                if (alSort === 'artist-asc')
                    return (a.artists || '').localeCompare(b.artists || '');
                if (alSort === 'artist-desc')
                    return (b.artists || '').localeCompare(a.artists || '');
                if (alSort === 'year-desc')
                    return (b.release_date || '').localeCompare(a.release_date || '');
                if (alSort === 'year-asc')
                    return (a.release_date || '').localeCompare(b.release_date || '');
                return 0;
            });
        }
        let artists = [...searchResults.artists];
        if (filterStr) {
            artists = artists.filter(a => (a.name || '').toLowerCase().includes(filterStr));
        }
        const arSort = sortOrders.artists;
        if (arSort !== 'default') {
            artists.sort((a, b) => {
                if (arSort === 'name-asc')
                    return (a.name || '').localeCompare(b.name || '');
                if (arSort === 'name-desc')
                    return (b.name || '').localeCompare(a.name || '');
                return 0;
            });
        }
        let playlists = [...searchResults.playlists];
        if (filterStr) {
            playlists = playlists.filter(p => (p.name || '').toLowerCase().includes(filterStr) || (p.owner || '').toLowerCase().includes(filterStr));
        }
        const pSort = sortOrders.playlists;
        if (pSort !== 'default') {
            playlists.sort((a, b) => {
                if (pSort === 'title-asc')
                    return (a.name || '').localeCompare(b.name || '');
                if (pSort === 'title-desc')
                    return (b.name || '').localeCompare(a.name || '');
                if (pSort === 'owner-asc')
                    return (a.owner || '').localeCompare(b.owner || '');
                if (pSort === 'owner-desc')
                    return (b.owner || '').localeCompare(a.owner || '');
                return 0;
            });
        }
        return { tracks, albums, artists, playlists };
    }, [searchResults, sortOrders, resultFilter]);
    const tabs: {
        key: ResultTab;
        label: string;
    }[] = [
        { key: "tracks", label: "Tracks" },
        { key: "albums", label: "Albums" },
        { key: "artists", label: "Artists" },
        { key: "playlists", label: "Playlists" },
    ];
    return (<div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <InputWithContext id="spotify-smart-search" placeholder={placeholderText} value={url} onChange={(e) => handleSmartInputChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleFetchWithValidation()} className="pr-8"/>
          {url && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" aria-label="Clear search input" onClick={() => {
                handleSmartInputChange("");
            }}>
              <XCircle className="h-4 w-4"/>
            </button>)}
        </div>

        <Button variant="outline" size="icon" className="shrink-0" aria-label="Paste from clipboard" onClick={() => void handleClipboardPaste()}>
          <Clipboard className="h-4 w-4"/>
        </Button>

        <Button onClick={handleFetchWithValidation} disabled={loading || (inputKind !== "spotify" && inputKind !== "next-url")}>
              {loading ? (<>
                  <Spinner />
                  Fetching...
                </>) : (<>
                  <CloudDownload className="h-4 w-4"/>
                  Fetch
                </>)}
        </Button>
      </div>

      {inputKind === "empty" && recentSearches.length > 0 && (<div className="space-y-2">
          <p className="text-sm text-muted-foreground">Recent Searches</p>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((query) => (<div key={query} className="group relative flex items-center px-3 py-1.5 bg-muted hover:bg-accent rounded-full text-sm cursor-pointer transition-colors" onClick={() => handleSmartInputChange(query)}>
                <span>{query}</span>
                <button type="button" className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-sm" onClick={(e) => {
                    e.stopPropagation();
                    removeRecentSearch(query);
                }}>
                  <X className="h-3 w-3 text-red-900" strokeWidth={3}/>
                </button>
              </div>))}
          </div>
        </div>)}

      {inputKind === "empty" && !hasResult && (<FetchHistory history={history} onSelect={onHistorySelect} onRemove={onHistoryRemove}/>)}

      {isSearchInput && (<div className="space-y-4">
          {isSearching && (<div className="flex items-center justify-center py-8">
              <Spinner />
              <span className="ml-2 text-muted-foreground">Searching...</span>
            </div>)}

          {!isSearching && url && !hasAnyResults && (<div className="text-center py-8 text-muted-foreground">
              No results found for "{url}"
            </div>)}

          {!isSearching && hasAnyResults && (<>
              <div className="flex gap-1 border-b mb-4">
                {tabs.map((tab) => {
                    const count = getTabCount(tab.key);
                    if (count === 0)
                        return null;
                    return (<button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={cn("px-4 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px", activeTab === tab.key
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground")}>
                      {tab.label} ({count})
                    </button>);
                })}
              </div>

              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                  <Input placeholder={`Search ${activeTab}...`} value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="pl-10 pr-8"/>
                  {resultFilter && (<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" onClick={() => setResultFilter("")}>
                      <XCircle className="h-4 w-4"/>
                    </button>)}
                </div>
                <Select value={sortOrders[activeTab]} onValueChange={(val) => setSortOrders(prev => ({ ...prev, [activeTab]: val }))}>
                  <SelectTrigger className="w-42.5 bg-background gap-1.5">
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground"/>
                    <SelectValue placeholder="Sort by"/>
                  </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      {activeTab === 'tracks' && (<>
                          <SelectItem value="title-asc">Title (A-Z)</SelectItem>
                          <SelectItem value="title-desc">Title (Z-A)</SelectItem>
                          <SelectItem value="artist-asc">Artist (A-Z)</SelectItem>
                          <SelectItem value="artist-desc">Artist (Z-A)</SelectItem>
                          <SelectItem value="duration-desc">Duration (Longest)</SelectItem>
                          <SelectItem value="duration-asc">Duration (Shortest)</SelectItem>
                        </>)}
                      {activeTab === 'albums' && (<>
                          <SelectItem value="title-asc">Title (A-Z)</SelectItem>
                          <SelectItem value="title-desc">Title (Z-A)</SelectItem>
                          <SelectItem value="artist-asc">Artist (A-Z)</SelectItem>
                          <SelectItem value="artist-desc">Artist (Z-A)</SelectItem>
                          <SelectItem value="year-desc">Year (Newest)</SelectItem>
                          <SelectItem value="year-asc">Year (Oldest)</SelectItem>
                        </>)}
                      {activeTab === 'artists' && (<>
                          <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                          <SelectItem value="name-desc">Name (Z-A)</SelectItem>
                        </>)}
                      {activeTab === 'playlists' && (<>
                          <SelectItem value="title-asc">Title (A-Z)</SelectItem>
                          <SelectItem value="title-desc">Title (Z-A)</SelectItem>
                          <SelectItem value="owner-asc">Owner (A-Z)</SelectItem>
                          <SelectItem value="owner-desc">Owner (Z-A)</SelectItem>
                        </>)}
                    </SelectContent>
                  </Select>
              </div>

              <div className="grid gap-2">
                {activeTab === "tracks" &&
                    sortedResults.tracks.map((track) => (<button key={track.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(track.external_urls)}>
                      {track.images ? (<img src={track.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="font-medium truncate">{track.name}</p>
                          {track.is_explicit && (<span className="flex items-center justify-center min-w-4 h-4 rounded bg-red-600 text-[10px] font-bold text-white leading-none shrink-0" title="Explicit">
                              E
                            </span>)}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {track.artists}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {formatDuration(track.duration_ms || 0)}
                      </span>
                    </button>))}

                {activeTab === "albums" &&
                    sortedResults.albums.map((album) => (<button key={album.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(album.external_urls)}>
                      {album.images ? (<img src={album.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{album.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {album.artists}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {album.release_date || ""}
                      </span>
                    </button>))}

                {activeTab === "artists" &&
                    sortedResults.artists.map((artist) => (<button key={artist.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(artist.external_urls)}>
                      {artist.images ? (<img src={artist.images} alt="" className="w-12 h-12 rounded-full object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded-full bg-muted shrink-0"/>)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                        <p className="text-sm text-muted-foreground">Artist</p>
                      </div>
                    </button>))}

                {activeTab === "playlists" &&
                    sortedResults.playlists.map((playlist) => (<button key={playlist.id} type="button" className="flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-accent border cursor-pointer text-left transition-colors" onClick={() => handleResultClick(playlist.external_urls)}>
                      {playlist.images ? (<img src={playlist.images} alt="" className="w-12 h-12 rounded object-cover shrink-0"/>) : (<div className="w-12 h-12 rounded bg-muted shrink-0"/>)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{playlist.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {playlist.owner || ""}
                        </p>
                      </div>
                    </button>))}
              </div>

              {hasMore[activeTab] && (<div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? (<>
                        <Spinner />
                        Loading...
                      </>) : (<>
                        <ChevronDown className="h-4 w-4"/>
                        Load More
                      </>)}
                  </Button>
                </div>)}
            </>)}
        </div>)}

      <Dialog open={showInvalidUrlDialog} onOpenChange={setShowInvalidUrlDialog}>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle>Unsupported Link</DialogTitle>
            <DialogDescription>
              Paste a Spotify link or enter plain text to search Spotify.
            </DialogDescription>
          </DialogHeader>

          {invalidUrl && (<div className="p-3 bg-muted rounded-md border text-xs font-mono break-all opacity-70">
              {invalidUrl}
            </div>)}

          <DialogFooter>
            <Button onClick={() => {
            setShowInvalidUrlDialog(false);
            setInvalidUrl("");
        }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNextDialog} onOpenChange={setShowNextDialog}>
        <DialogContent className="sm:max-w-115 [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Open with SpotiFLAC Next</DialogTitle>
            <DialogDescription>
              {nextProvider || "This service"} links are supported in SpotiFLAC Next. This version only accepts Spotify links.
            </DialogDescription>
          </DialogHeader>

          {invalidUrl && (<div className="p-3 bg-muted rounded-md border text-xs font-mono break-all opacity-70">
              {invalidUrl}
            </div>)}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setShowNextDialog(false)}>
              Not Now
            </Button>
            <Button onClick={() => {
            openExternal(SPOTIFLAC_NEXT_URL);
            setShowNextDialog(false);
        }}>
              <ExternalLink className="h-4 w-4"/>
              Get SpotiFLAC Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);
}
