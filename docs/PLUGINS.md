# Créer un plugin Tessera

Un plugin est un **dossier** avec un `manifest.json` et des pages HTML. Chaque widget du plugin tourne dans une **iframe isolée** : pas de Node, pas de réseau, pas d'accès à l'interface de Tessera. Il parle à Tessera uniquement avec le SDK (`window.tessera`).

Exemple complet : [`examples/plugins/hello-counter`](../examples/plugins/hello-counter).

## Installer un plugin local

Plugins → **Charger un plugin local** → choisir le dossier. Tessera vérifie le manifest, montre les permissions demandées, puis l'installe. Le plugin reste dans son dossier : modifie tes fichiers puis rouvre le projet pour voir les changements.

## manifest.json

```json
{
  "id": "pseudo.mon-plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "author": "pseudo",
  "description": "Ce que fait le plugin.",
  "icon": "puzzle",
  "engines": { "tessera": "^0.1.0" },
  "permissions": ["fs.project.read"],
  "contributes": {
    "widgets": [
      {
        "id": "main",
        "title": "Mon widget",
        "description": "Une phrase courte",
        "icon": "stars",
        "category": "tools",
        "entry": "widget.html"
      }
    ]
  }
}
```

| Champ | Règle |
| --- | --- |
| `id` | `auteur.nom`, minuscules, chiffres et `-`. `core.*` et `tessera.*` sont réservés. |
| `version` | semver (`1.2.3`) |
| `icon` | un nom [Bootstrap Icons](https://icons.getbootstrap.com/) |
| `category` | `project`, `files`, `editing`, `media`, `publishing`, `tools`, `other` (range le widget dans le tiroir) |
| `entry` | chemin relatif dans le dossier du plugin, sans `..` |
| `permissions` | voir plus bas. Une permission inconnue fait refuser le plugin. |

## La page du widget

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="/__tessera/sdk.js"></script>
  </head>
  <body>
    <button class="atrium-btn atrium-btn-primary" id="go"><i class="bi bi-stars"></i> Go</button>
    <script src="widget.js"></script>
  </body>
</html>
```

`/__tessera/sdk.js` ajoute aussi les styles d'Atrium et les icônes : les classes `atrium-*` et `bi bi-*` marchent directement, et le thème clair/sombre suit Tessera.

Règles de la page (CSP) : scripts uniquement depuis le dossier du plugin (pas de script inline, pas d'`eval`), aucune requête réseau, pas de sous-iframe.

## SDK

```js
await tessera.ready;                          // attendre que Tessera ait répondu

await tessera.ui.toast('success', 'Fait');    // 'success' | 'info' | 'warning' | 'error'

const state = await tessera.widget.getState(); // état sauvegardé dans le layout (64 Ko max)
await tessera.widget.setState({ count: 3 });

const project = await tessera.project.info();  // { name, kind, status }

const entries = await tessera.files.list('sources');      // permission fs.project.read
const text = await tessera.files.readText('sources/a.txt'); // permission fs.project.read, 1 Mo max

tessera.on('theme', ({ theme }) => {});        // 'dark' | 'light'
```

Chaque appel renvoie une promesse. En cas de refus, elle échoue avec un message (`permission denied: fs.project.read`, `invalid params`, `rate limited`…). Un plugin peut faire au plus 40 appels par seconde par widget.

Les raccourcis clavier (Ctrl+K, Ctrl+L…) tapés dans le widget sont transmis à Tessera.

## Permissions

| Permission | Risque | Ce qu'elle permet |
| --- | --- | --- |
| `fs.project.read` | faible | lister et lire les fichiers texte du projet ouvert, sauf `.tessera/` |

L'utilisateur peut retirer une permission à tout moment dans Plugins ; l'effet est immédiat. D'autres permissions (écriture, réseau limité, programmes externes) arriveront plus tard, chacune avec son propre accord.
