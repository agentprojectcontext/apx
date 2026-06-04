import { useState } from "react";
import { ChatInput } from "../ui/chat-input";
import { ModelPicker } from "./ModelPicker";
import { t } from "../../i18n";

interface Props {
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
  streaming: boolean;
  /** Selected model override ("" = Auto). Omit to hide the picker. */
  model?: string;
  onModelChange?: (m: string) => void;
}

export function Composer({ onSend, onStop, streaming, model, onModelChange }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    void onSend(v);
  };

  return (
    <div className="border-t border-border bg-card/60 p-3">
      <ChatInput
        value={text}
        onValueChange={setText}
        onSubmit={submit}
        onStop={onStop}
        busy={streaming}
        placeholder={t("project.chat.placeholder")}
        maxRows={12}
        footer={
          onModelChange ? (
            <ModelPicker value={model || ""} onChange={onModelChange} disabled={streaming} />
          ) : undefined
        }
      />
    </div>
  );
}
