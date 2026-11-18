import { useCallback, useEffect, useState } from "react";

/** 固定行高虚拟窗口：只渲染可视区 ± overscan */
export function useVirtualRange(
  itemCount: number,
  itemSize: number,
  overscan = 8,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  const onScroll = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportH(el.clientHeight);
  }, []);

  const attach = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return () => {};
      const sync = () => {
        setScrollTop(el.scrollTop);
        setViewportH(el.clientHeight);
      };
      sync();
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      return () => ro.disconnect();
    },
    [],
  );

  useEffect(() => {
    // itemCount 变化时不重置 scrollTop（由容器自己管）
  }, [itemCount]);

  const start = Math.max(
    0,
    Math.floor(scrollTop / Math.max(itemSize, 1)) - overscan,
  );
  const visible = Math.ceil(viewportH / Math.max(itemSize, 1)) + overscan * 2;
  const end = Math.min(itemCount, start + Math.max(visible, 1));

  return {
    start,
    end,
    offsetY: start * itemSize,
    totalH: itemCount * itemSize,
    onScroll,
    attach,
    setScrollTop,
    setViewportH,
  };
}
