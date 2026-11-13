import { useEffect, useState } from 'react';

/**
 * Debounces a fast-changing value (search boxes) so we do not hammer the
 * database on every keystroke.
 */
export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebouncedValue;