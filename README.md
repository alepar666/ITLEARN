# Italienisch B1

Eine deutschsprachige PWA zum Lernen und Wiederholen von italienischem Wortschatz, Verben und Grammatik auf B1-Niveau. Sie funktioniert offline und speichert Lernstände lokal im Browser. Das Wiederholungssystem, die Kartenfilter, die Wortschatzsuche und die geräteübergreifende Synchronisierung folgen dem Projekt [Ripasso B1](https://github.com/alepar666/DELEARN).

Der Wortschatz ist in die Gegenrichtung übertragen: Auf der Vorderseite steht Deutsch, auf der Rückseite Italienisch. Verbkarten enthalten zusätzlich eine Karte zum italienischen Partizip Perfekt. Die Grammatikfragen erklären die italienischen B1-Strukturen auf Deutsch.

## Auf GitHub Pages veröffentlichen

1. Lade die Dateien im Stammverzeichnis dieses Repositorys hoch und pushe sie auf den Branch, den du veröffentlichen möchtest.
2. Öffne **Settings → Pages**.
3. Wähle unter **Build and deployment** die Option **Deploy from a branch**, dann den Branch und den Ordner `/(root)`.
4. Die App ist anschließend unter `https://alepar666.github.io/ITLEARN/` erreichbar.
5. Auf dem iPhone in Safari die Seite öffnen und über **Teilen → Zum Home-Bildschirm** installieren.

Die PWA muss einmal online geöffnet werden, damit sie die Dateien für den Offlinebetrieb herunterladen kann. Service Worker funktionieren auf HTTPS oder einem lokalen Webserver, nicht beim direkten Öffnen von `index.html`.

## Lernfortschritt

Neue Karten und fällige Wiederholungen werden abgewechselt. Nach einer richtigen Antwort folgt die nächste Wiederholung zunächst nach einem Tag, dann nach drei Tagen; weitere Abstände richten sich nach dem Lernverlauf. Bei einer falschen Antwort erscheint die Karte später erneut. Es gibt kein Tageslimit.

Der Lernfortschritt wird mit einem eigenen Speicherpräfix getrennt von Ripasso B1 abgelegt. Für die Synchronisierung zwischen Geräten öffne **Zwischen Geräten synchronisieren**, erstelle auf einem Gerät einen Code und gib ihn auf dem zweiten Gerät ein. Der Dienst ist in `sync-config.js` eingetragen; die Profile werden anhand des zufälligen Codes getrennt.

## Lizenz und Herkunft

Der wiederverwendete PWA-Code und die neu zusammengestellten Lernkarten werden gemäß der beiliegenden [PolyForm Noncommercial License 1.0.0](LICENSE) für nichtkommerzielle Zwecke bereitgestellt. Der ursprüngliche Urheberhinweis steht in [NOTICE](NOTICE). Der aus Ripasso B1 übernommene Wortschatz wurde für die Richtung Deutsch → Italienisch umgestellt; die italienischen Grammatikfragen wurden eigens für dieses Lernziel formuliert.
