import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';

/**
 * Academic structure (classes, sections, subjects, sessions) used by every
 * dropdown in the app. Loaded once and shared per page.
 */
export function useStructure() {
  const [structure, setStructure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.structure.get();
      setStructure(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sectionsOf = useCallback(
    (classId) => {
      if (!classId || !structure) return [];
      return structure.sections.filter((s) => s.class_id === Number(classId));
    },
    [structure],
  );

  const className = useCallback(
    (classId) => structure?.classes.find((c) => c.id === Number(classId))?.name ?? null,
    [structure],
  );

  return { structure, loading, error, reload: load, sectionsOf, className };
}

export default useStructure;