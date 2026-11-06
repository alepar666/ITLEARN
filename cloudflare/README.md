# Synchronisierung

Die PWA verwendet den bereits veröffentlichten, app-übergreifenden Synchronisierungsdienst aus `sync-config.js`. Lernprofile werden über einen zufällig erzeugten Code getrennt; der lokale Fortschritt dieser App verwendet eigene Speicher- und Profilkennungen. Für den Betrieb auf GitHub Pages ist keine erneute Veröffentlichung des Workers erforderlich.

Der Worker und das D1-Schema in diesem Ordner entsprechen dem bestehenden Dienst. Ändere oder veröffentliche sie nur, wenn du den Synchronisierungsdienst selbst warten möchtest.
