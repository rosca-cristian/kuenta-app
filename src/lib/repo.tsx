import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DataRepository } from '../data/repository';
import type { PlatformServices } from '../platform/platform';

interface Services {
  repo: DataRepository;
  platform: PlatformServices;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ repo, platform, children }: Services & { children: ReactNode }) {
  return <ServicesContext.Provider value={{ repo, platform }}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider is missing');
  return services;
}

export const useRepo = () => useServices().repo;

/**
 * Runs a repository query and re-runs it after every write, or when `deps` change.
 * Returns undefined while the first result is loading.
 */
export function useRepoQuery<T>(query: (repo: DataRepository) => Promise<T>, deps: unknown[] = []): T | undefined {
  const repo = useRepo();
  const [result, setResult] = useState<{ value: T; key: string } | undefined>();
  const key = JSON.stringify(deps);

  useEffect(() => {
    let active = true;
    const run = () =>
      query(repo).then((value) => {
        if (active) setResult({ value, key });
      });
    void run();
    const unsubscribe = repo.subscribe(() => void run());
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, key]);

  return result?.key === key ? result.value : undefined;
}
