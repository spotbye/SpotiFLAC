import * as React from "react";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, } from "@/components/ui/context-menu";
import { Scissors, Copy, Clipboard, Type } from "lucide-react";
import { ClipboardGetText, ClipboardSetText } from "../../../wailsjs/runtime/runtime";
export interface InputWithContextProps extends React.InputHTMLAttributes<HTMLInputElement> {
    onValueChange?: (value: string) => void;
}
const InputWithContext = React.forwardRef<HTMLInputElement, InputWithContextProps>(({ className, type, onValueChange, onChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [hasSelection, setHasSelection] = React.useState(false);
    const [canPaste, setCanPaste] = React.useState(false);
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
    const updateSelectionState = () => {
        const input = inputRef.current;
        if (!input)
            return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        setHasSelection(start !== end);
    };
    const checkClipboard = async () => {
        try {
            const text = await ClipboardGetText();
            setCanPaste(text.length > 0);
        }
        catch {
            setCanPaste(false);
        }
    };
    const handleCut = async () => {
        const input = inputRef.current;
        if (!input)
            return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        const selectedText = input.value.substring(start, end);
        if (selectedText) {
            try {
                if (!await ClipboardSetText(selectedText))
                    throw new Error("Wails could not write to the clipboard");
                const newValue = input.value.substring(0, start) + input.value.substring(end);
                input.value = newValue;
                input.setSelectionRange(start, start);
                if (onChange) {
                    const event = {
                        target: input,
                        currentTarget: input,
                    } as React.ChangeEvent<HTMLInputElement>;
                    onChange(event);
                }
                if (onValueChange) {
                    onValueChange(newValue);
                }
                input.focus();
            }
            catch (err) {
                console.error("Failed to cut:", err);
            }
        }
    };
    const handleCopy = async () => {
        const input = inputRef.current;
        if (!input)
            return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? 0;
        const selectedText = input.value.substring(start, end);
        if (selectedText) {
            try {
                if (!await ClipboardSetText(selectedText))
                    throw new Error("Wails could not write to the clipboard");
                input.focus();
            }
            catch (err) {
                console.error("Failed to copy:", err);
            }
        }
    };
    const handlePaste = async () => {
        const input = inputRef.current;
        if (!input)
            return;
        try {
            const text = await ClipboardGetText();
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? 0;
            const newValue = input.value.substring(0, start) + text + input.value.substring(end);
            input.value = newValue;
            const newPosition = start + text.length;
            input.setSelectionRange(newPosition, newPosition);
            if (onChange) {
                const event = {
                    target: input,
                    currentTarget: input,
                } as React.ChangeEvent<HTMLInputElement>;
                onChange(event);
            }
            if (onValueChange) {
                onValueChange(newValue);
            }
            input.focus();
            await checkClipboard();
        }
        catch (err) {
            console.error("Failed to paste:", err);
        }
    };
    const handleSelectAll = () => {
        const input = inputRef.current;
        if (!input)
            return;
        input.select();
        input.focus();
        updateSelectionState();
    };
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (onChange) {
            onChange(e);
        }
        if (onValueChange) {
            onValueChange(e.target.value);
        }
    };
    return (<ContextMenu onOpenChange={(open) => {
            if (open) {
                checkClipboard();
            }
        }}>
        <ContextMenuTrigger asChild>
          <Input ref={inputRef} type={type} className={className} onChange={handleInputChange} onSelect={updateSelectionState} onMouseUp={updateSelectionState} onKeyUp={updateSelectionState} {...props}/>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={handleCut} disabled={!hasSelection || props.disabled || props.readOnly}>
            <Scissors className="mr-2 h-4 w-4"/>
            Cut
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+X</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy} disabled={!hasSelection || props.disabled}>
            <Copy className="mr-2 h-4 w-4"/>
            Copy
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handlePaste} disabled={!canPaste || props.disabled || props.readOnly}>
            <Clipboard className="mr-2 h-4 w-4"/>
            Paste
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleSelectAll} disabled={!inputRef.current?.value || props.disabled}>
            <Type className="mr-2 h-4 w-4"/>
            Select All
            <span className="ml-auto text-xs text-muted-foreground">Ctrl+A</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>);
});
InputWithContext.displayName = "InputWithContext";
export { InputWithContext };
