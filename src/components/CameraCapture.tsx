"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  photos: string[];
  onChange: (photos: string[]) => void;
}

/**
 * Live capture only — getUserMedia() streamed straight to a <video>,
 * captured to a <canvas>, exported as a data URL. There is deliberately
 * no <input type="file"> anywhere in this component, so the OS's own
 * camera-app-via-gallery-picker shortcut is never shown. This closes that
 * specific gap but not a genuinely adversarial modified browser or
 * "photograph a photo on another screen" — see architecture.md sec.7 and
 * business-process-design.md BR-093 for why the weekly Auditor sample
 * audit is doing real load-bearing work here, not just serving as a
 * backstop.
 */
export function CameraCapture({ photos, onChange }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      setError("Could not access the camera. Check browser permissions and try again.");
    }
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onChange([...photos, dataUrl]);
  }

  function removePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreaming(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!streaming ? (
        <button
          type="button"
          onClick={startCamera}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Open camera
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <video ref={videoRef} className="w-full max-w-md rounded-md border border-slate-300" muted playsInline />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={capture}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Capture photo
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Close camera
            </button>
          </div>
        </div>
      )}

      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- captured data URLs, not a static asset */}
              <img src={photo} alt={`Captured evidence ${i + 1}`} className="h-24 w-24 rounded-md border border-slate-300 object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white"
                aria-label={`Remove photo ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">At least one live-captured photo is required.</p>
      )}
    </div>
  );
}
