import { useCallback, useEffect, useRef, useState } from "react";
import { MOTION_PRESETS } from "../vendor/purupuru/core/parameters";
import { EMPTY_REGION } from "../vendor/purupuru/region/model";
import { compareSliceNames, type EpisodeSlice } from "./episode";

/** 이 이상은 텍스처로도, 저작 캔버스로도 감당이 안 된다. */
export const MAX_IMAGE_EDGE = 8000;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** 디코딩 전에 알 수 있는 거절 사유만 본다. 통과면 null. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "PNG · JPEG · WebP 이미지만 불러올 수 있습니다.";
  }
  return null;
}

export interface ImageFilesState {
  slices: EpisodeSlice[];
  error: string | null;
  loadFiles: (files: readonly File[]) => void;
}

/** id 는 이름과 무관해야 한다 — 다른 폴더에서 같은 파일명을 같이 골라도 키가 겹치면 안 된다. */
let nextSliceId = 0;

/**
 * 회차 전체(60~70장)를 **<img> 로만** 연다.
 *
 * createImageBitmap 이나 캔버스로 옮기는 순간 브라우저가 디코드된 비트맵을 버릴 수 없게 되어
 * 25MB × 장수가 그대로 상주한다. <img> 로 두면 뷰포트 근처만 디코드하고 나머지는 회수한다 —
 * 웹툰 뷰어가 전부 이렇게 동작한다. 크기는 onload 의 naturalWidth/Height 로만 읽고,
 * decode() 를 전체에 돌리지 않는다 (그러면 강제로 다 디코드된다).
 */
export function useImageFiles(): ImageFilesState {
  const [slices, setSlices] = useState<EpisodeSlice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  const revokeAll = (urls: readonly string[]): void => {
    for (const url of urls) URL.revokeObjectURL(url);
  };

  useEffect(() => () => {
    revokeAll(urlsRef.current);
    urlsRef.current = [];
  }, []);

  const loadFiles = useCallback((files: readonly File[]): void => {
    const accepted = files.filter((file) => validateImageFile(file) === null);
    const rejected = files.length - accepted.length;
    if (accepted.length === 0) {
      setError("PNG · JPEG · WebP 이미지만 불러올 수 있습니다.");
      return;
    }

    const urls: string[] = [];
    const loads = accepted.map(
      (file) =>
        new Promise<EpisodeSlice | null>((resolve) => {
          const url = URL.createObjectURL(file);
          urls.push(url);
          const element = new Image();
          element.onload = () => {
            const width = element.naturalWidth || element.width;
            const height = element.naturalHeight || element.height;
            // 한 변 상한을 넘거나 크기를 못 읽은 장은 조용히 뺀다. 이유는 아래에서 한 줄로 묶어 알린다.
            if (!(width > 0) || !(height > 0) || Math.max(width, height) > MAX_IMAGE_EDGE) {
              resolve(null);
              return;
            }
            nextSliceId += 1;
            resolve({
              id: `slice-${nextSliceId}`,
              name: file.name,
              element,
              width,
              height,
              region: EMPTY_REGION,
              motion: { ...MOTION_PRESETS.purupuru },
              seed: 1,
            });
          };
          element.onerror = () => resolve(null);
          element.src = url;
        }),
    );

    void Promise.all(loads).then((results) => {
      const loaded = results.filter((slice): slice is EpisodeSlice => slice !== null);
      const failed = results.length - loaded.length;
      if (loaded.length === 0) {
        revokeAll(urls);
        setError("이미지를 읽지 못했습니다. 파일이 손상되었거나 너무 큽니다.");
        return;
      }
      // 이전 배치는 새 배치가 자리를 잡은 뒤에 회수한다 (먼저 회수하면 화면의 미리보기가 깨진다).
      revokeAll(urlsRef.current);
      urlsRef.current = urls;
      setError(
        failed + rejected === 0
          ? null
          : `${failed + rejected}개 파일을 건너뛰었습니다 (형식이 아니거나 ${MAX_IMAGE_EDGE}px 초과).`,
      );
      setSlices([...loaded].sort((a, b) => compareSliceNames(a.name, b.name)));
    });
  }, []);

  return { slices, error, loadFiles };
}
