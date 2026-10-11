import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import type { ProjectService } from './service';

export const COVER_SCHEME = 'tessera-cover';

export function registerCoverScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: COVER_SCHEME, privileges: { standard: true, secure: true } }]);
}

export function handleCoverProtocol(projects: ProjectService) {
  protocol.handle(COVER_SCHEME, async (request) => {
    const id = new URL(request.url).hostname;
    const file = await projects.coverPath(id);
    if (!file) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}
