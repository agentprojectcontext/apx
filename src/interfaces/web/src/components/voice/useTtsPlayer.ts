import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTtsAudioUrl } from "../../lib/api/voice";

// Small player hook: fetches a sandboxed /voice/tts blob (auth bearer) for an
// absolute audio_path and plays it in an <audio> element. Revokes the object
// URL on the next play / unmount so blobs don't leak.
export function useTtsPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const cleanup = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      cleanup();
    };
  }, [cleanup]);

  const play = useCallback(async (audioPath: string) => {
    setLoading(true);
    try {
      cleanup();
      const url = await fetchTtsAudioUrl(audioPath);
      urlRef.current = url;
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const el = audioRef.current;
      el.src = url;
      el.onended = () => setPlaying(false);
      el.onerror = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } finally {
      setLoading(false);
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(false);
  }, []);

  return { play, stop, playing, loading };
}
