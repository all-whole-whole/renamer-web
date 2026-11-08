import { useCallback, useEffect, useState } from 'react';

export type Route = 'gallery' | 'foundations';

const ROUTES: Route[] = ['gallery', 'foundations'];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(raw as Route) ? (raw as Route) : 'gallery';
}

/** hash 路由：静态托管、Node 宿主挂载都不需要改服务器回退规则。 */
export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const onHashChange = () => setRoute(parse());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (parse() === next) {
      setRoute(next);
      return;
    }
    window.location.hash = `/${next}`;
  }, []);

  return [route, navigate];
}
