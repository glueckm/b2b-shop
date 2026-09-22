# Eine Datenbankverbindung pro Katalogaufruf

## Änderung
- Die Datenbankverbindung wird zu Beginn des Katalogaufrufs einmal geöffnet.
- Die Sitzung erhält eine eigene `query`-Funktion, die fest an genau diese Verbindung gebunden ist.
- Kunden-/Preisgruppenabfrage, Artikelliste, Kategorien und Kennzahlen verwenden ausschließlich diese Sitzungsfunktion.
- Der bisherige optionale Fallback, der unbemerkt eine zweite Verbindung öffnen kann, bleibt nur für bewusst unabhängige Aufgaben außerhalb des Katalogaufrufs.

## Prüfung
- Temporäre, nicht sensible Verbindungskennungen protokollieren, um dieselbe Sitzung für Kunden- und NET6-Abfrage zu bestätigen.
- Katalog einmal kalt und einmal aus dem Cache laden.
- Fehlerprotokoll und Vorschau prüfen; Versionsnummer erhöhen.

## Technische Details
Die Sitzung kapselt den bereits verbundenen PostgreSQL-Client. Dadurch kann weder ein getrennt gebündeltes Modul noch ein fehlender Laufzeit-Kontext eine zweite Verbindung innerhalb desselben Katalogaufrufs erzeugen.
