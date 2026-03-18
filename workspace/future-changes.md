

# Architecture / Internal
- Consider extracting dropdown logic to separate module. Apply shared logic to sort dropdown? 
- Refactor buildDropdownPanel to explict factory/strategy methods, rather than awkward switch.
- Minimize IDB transaction with some bulk get-by-ids method for loading just the tracks in the chosen playlist set? 
- Make internal names more consistent for filter/search feature? Currently search=user action, filter=underlying operation.

# Table Look / Features
- Differentiate look for album/artist text in info columns?
- Link to artist/album/track where relevant?
- Make checkbox bigger or redesign cell to emphasize clickability.
- Consider showing a placeholder table row while loading, for visual consistency
- Resize index column if track set reaches 4-5 digits
- highlight playlist columns when their header is hovered?

# Sort
- Tracks with missing fields would appear at top when sorted by that field, consider shifting to bottom
- Reconsider sort names: ["Recently Added", "Default", "Order Added (Default)", "Added Order".] ["Most Playlists", "Playlist Count", "Most Represented", "Frequency Found"]
- Current dropdown for sort doesnt match current playlist look.

# Modals
- Document warning displays somewhere, worth auditing audit when, why, and how each case is handled.
- emptyPlaylists check in handleBackButton: Reconsider best options and explanation - current wording is clunky. Same goes for listing of playlists in label.
- handleDeleteTrack check for multiple selected: more concise explanation of stakes

# Features: (Not the main place for these)
- Option to select all (including non-visible tracks) in workspace from handleBulkMembershipUpdate
- Advanced creation/selection: Union, intersection, complement of sets. I'd totally use these but probably not a flagship feature to sell most users on.
- Add toasts to confirm certain dropdown actions? (session changes that might not be immediately apparent) Just the destructive ones?
- track a stack of user actions, facilitating undo/redo? Ties into toast idea with an undo button, but adds substantial complexity to data layer.

# Misc thoughts, or beyond workspace
- Determinate progress indicators for progress bar(s) in dashboard and load process.
- Better homes for filter/selection counters? kinda just floating in control bar for now
- Warn user of bad playlist references while loading?
- Consider future of "open in spotify" dropdown option
- Add some "orphaned tracks" feature in the dashboard to see tracks no longer represented in any playlist? For ease of use, and avoiding inaccessible data we don't need to keep around