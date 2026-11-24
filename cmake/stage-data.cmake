# Puts one shipped data folder beside the built FASTag (CMakeLists.txt,
# FASTAG_STAGE_DATA_IN_BUILD, target fastag_stage_data, run on every build):
# cmake -DSRC=<data/x> -DDST=<bin dir>/share-FASTag-x [-DCOPY=ON]
# [-DINDEX=<folder or file>] [-DINDEX_SEARCH=<folder>|<folder>...] -P stage-data.cmake.
#
# A symlink to SRC (it follows edits to data/), or with COPY=ON (Windows,
# where a symlink needs Developer Mode) a folder holding a copy of each entry
# of SRC; a restage copies what changed and removes what SRC no longer has.
#
# INDEX (the taxonomy, FASTAG_TAXONOMY_INDEX_DIR): a folder holding the k-mer
# index tax_k7.taxdb and the dumps it was built from, as the release asset
# FASTag-<version>-taxonomy-k7.tar.gz unpacks. DST is then a folder of its own:
# every entry of SRC, with tax_k7.taxdb, nodes.dmp, names.dmp and MANIFEST.json
# from INDEX in place of the repo's, as the release workflows assemble
# share-FASTag-taxonomy. Each is a link, or a copy with COPY=ON (copied again
# only when it changed). INDEX may also name the index file itself (any name):
# it is staged as tax_k7.taxdb, and the dumps stay those of SRC.
#
# INDEX_SEARCH (the taxonomy without INDEX; FASTAG_TAXONOMY_INDEX_AUTO): folders
# separated by "|", looked at on every run; the first that holds tax_k7.taxdb
# is INDEX (tools/fetch_taxonomy_index.py puts the release asset there). None
# does: SRC alone, as without INDEX, so a removed cache is unstaged again.
#
# Every real folder the script makes carries .fastag-staged, which lists the
# top-level entries it staged there; only those are ever replaced or removed.
# A real folder at DST without the marker is the user's, in both modes, and is
# left alone (also a folder copy-staged before the marker existed: delete it
# to restage).
if(NOT SRC OR NOT DST)
  message(FATAL_ERROR "stage-data.cmake: SRC and DST are required")
endif()
set(_mark "${DST}/.fastag-staged")
set(_from_index tax_k7.taxdb nodes.dmp names.dmp MANIFEST.json)

# Link (or copy) @p from to @p to.
function(_fastag_put from to)
  if(COPY)
    if(IS_SYMLINK "${to}")
      file(REMOVE "${to}")
    elseif(EXISTS "${to}")
      # A file that became a folder, or the other way round.
      if(IS_DIRECTORY "${from}" AND NOT IS_DIRECTORY "${to}")
        file(REMOVE "${to}")
      elseif(NOT IS_DIRECTORY "${from}" AND IS_DIRECTORY "${to}")
        file(REMOVE_RECURSE "${to}")
      endif()
    endif()
    if(IS_DIRECTORY "${from}" AND IS_DIRECTORY "${to}")
      # Remove what the source folder no longer has.
      file(GLOB_RECURSE _have LIST_DIRECTORIES true RELATIVE "${to}" "${to}/*")
      foreach(_h IN LISTS _have)
        if(NOT EXISTS "${from}/${_h}" AND (EXISTS "${to}/${_h}" OR IS_SYMLINK "${to}/${_h}"))
          file(REMOVE_RECURSE "${to}/${_h}")
        endif()
      endforeach()
    endif()
    get_filename_component(_dir "${to}" DIRECTORY)
    get_filename_component(_fname "${from}" NAME)
    get_filename_component(_tname "${to}" NAME)
    if(_fname STREQUAL _tname)
      file(COPY "${from}" DESTINATION "${_dir}")
    elseif(NOT EXISTS "${to}" OR "${from}" IS_NEWER_THAN "${to}")
      # An index file under another name, copied as tax_k7.taxdb.
      file(COPY_FILE "${from}" "${to}")
    endif()
  else()
    if(IS_SYMLINK "${to}" OR EXISTS "${to}")
      file(REMOVE_RECURSE "${to}")
    endif()
    file(CREATE_LINK "${from}" "${to}" SYMBOLIC)
  endif()
endfunction()

# The top-level entries of DST the marker says the script staged. A marker
# written before it listed them (a single "Staged by" line) owned what that
# version staged: the entries of SRC and the index files.
function(_fastag_owned out)
  file(STRINGS "${_mark}" _lines)
  set(_owned "")
  set(_legacy OFF)
  foreach(_e IN LISTS _lines)
    if(_e MATCHES "^Staged by ")
      set(_legacy ON)
    elseif(_e STREQUAL "" OR _e MATCHES "^#" OR _e MATCHES "[/\\\\]" OR _e STREQUAL "." OR _e STREQUAL ".."
           OR _e STREQUAL ".fastag-staged")
      # not an entry of ours
    else()
      list(APPEND _owned "${_e}")
    endif()
  endforeach()
  if(_legacy)
    file(GLOB _src RELATIVE "${SRC}" "${SRC}/*")
    list(APPEND _owned ${_src} ${_from_index})
    list(REMOVE_ITEM _owned ".fastag-staged")
  endif()
  list(REMOVE_DUPLICATES _owned)
  set(${out} "${_owned}" PARENT_SCOPE)
endfunction()

# Removes the entries of DST the marker lists, other than those in @p keep.
# With nothing to keep, DST itself when nothing else (a file of the user's)
# is left in it; else the marker stays, owning nothing, so that a later run
# links DST once the user's files are gone.
function(_fastag_unstage keep)
  _fastag_owned(_owned)
  foreach(_e IN LISTS _owned)
    list(FIND keep "${_e}" _k)
    if(_k LESS 0 AND (EXISTS "${DST}/${_e}" OR IS_SYMLINK "${DST}/${_e}"))
      file(REMOVE_RECURSE "${DST}/${_e}")
    endif()
  endforeach()
  if(NOT keep)
    file(GLOB _left "${DST}/*")
    list(REMOVE_ITEM _left "${_mark}")
    if(NOT _left)
      file(REMOVE_RECURSE "${DST}")
    else()
      file(WRITE "${_mark}" "# Staged by cmake/stage-data.cmake; it owns no entry here now.\n")
    endif()
  endif()
endfunction()

if(NOT INDEX AND INDEX_SEARCH)
  string(REPLACE "|" ";" _search "${INDEX_SEARCH}")
  foreach(_c IN LISTS _search)
    if(_c AND EXISTS "${_c}/tax_k7.taxdb")
      set(INDEX "${_c}")
      break()
    endif()
  endforeach()
endif()

# The files INDEX supplies: their names here and their paths there.
set(_idx_names "")
set(_idx_froms "")
if(INDEX)
  if(IS_DIRECTORY "${INDEX}")
    if(NOT EXISTS "${INDEX}/tax_k7.taxdb")
      message(FATAL_ERROR "stage-data.cmake: no tax_k7.taxdb in '${INDEX}' (FASTAG_TAXONOMY_INDEX_DIR)")
    endif()
    foreach(_i IN LISTS _from_index)
      if(EXISTS "${INDEX}/${_i}")
        list(APPEND _idx_names "${_i}")
        list(APPEND _idx_froms "${INDEX}/${_i}")
      endif()
    endforeach()
  elseif(EXISTS "${INDEX}")
    list(APPEND _idx_names "tax_k7.taxdb")
    list(APPEND _idx_froms "${INDEX}")
  else()
    message(FATAL_ERROR "stage-data.cmake: '${INDEX}' is neither a folder with tax_k7.taxdb nor an index file "
                        "(FASTAG_TAXONOMY_INDEX_DIR)")
  endif()
endif()

# What a staged folder holds (INDEX or COPY): each entry's name and source.
set(_names "")
set(_froms "")
if(INDEX OR COPY)
  file(GLOB _items RELATIVE "${SRC}" "${SRC}/*")
  list(REMOVE_ITEM _items ".fastag-staged")
  foreach(_i IN LISTS _items)
    list(FIND _idx_names "${_i}" _k)
    if(_k LESS 0)
      list(APPEND _names "${_i}")
      list(APPEND _froms "${SRC}/${_i}")
    endif()
  endforeach()
  list(APPEND _names ${_idx_names})
  list(APPEND _froms ${_idx_froms})
endif()

# Who owns DST, decided before anything is written: a symlink is ours, a real
# folder only with the marker.
if(IS_SYMLINK "${DST}")
  if(NOT INDEX AND NOT COPY)
    file(READ_SYMLINK "${DST}" _target)
    if(_target STREQUAL SRC)
      return()
    endif()
  endif()
  file(REMOVE "${DST}")
elseif(EXISTS "${DST}" AND NOT EXISTS "${_mark}")
  message(STATUS "stage-data.cmake: ${DST} is a folder of its own (no .fastag-staged); it is kept and ${SRC} "
                 "is not staged there (delete it to restage)")
  return()
elseif(EXISTS "${_mark}")
  if(INDEX OR COPY)
    # Restaged in place: drop what is staged no more, keep the rest.
    _fastag_unstage("${_names}")
  else()
    # Back to a link to SRC: remove what was staged.
    _fastag_unstage("")
    if(EXISTS "${DST}")
      message(STATUS "stage-data.cmake: ${DST} holds files that were not staged; it is kept "
                     "(not linked to ${SRC}; delete it to restage)")
      return()
    endif()
  endif()
endif()

if(NOT INDEX AND NOT COPY)
  file(CREATE_LINK "${SRC}" "${DST}" SYMBOLIC)
  return()
endif()
file(MAKE_DIRECTORY "${DST}")
set(_list "# Staged by cmake/stage-data.cmake from ${SRC}")
if(INDEX)
  string(APPEND _list " and ${INDEX}")
endif()
string(APPEND _list "; the entries it owns here, one per line:\n")
list(LENGTH _names _n)
if(_n GREATER 0)
  math(EXPR _last "${_n} - 1")
  foreach(_k RANGE ${_last})
    list(GET _names ${_k} _name)
    list(GET _froms ${_k} _from)
    _fastag_put("${_from}" "${DST}/${_name}")
    string(APPEND _list "${_name}\n")
  endforeach()
endif()
file(WRITE "${_mark}" "${_list}")
