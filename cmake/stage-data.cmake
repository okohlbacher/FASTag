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
# separated by "|", looked at on every run, with INDEX_MANIFESTS the pinned
# manifest of each (data/taxonomy/manifests/<data release>.json, "|"-separated,
# in the same order); the first that holds a complete fetch of its manifest is
# INDEX. A complete fetch is what tools/fetch_taxonomy_index.py publishes: its
# completion marker .fastag-fetched names that very manifest (data release and
# sha256) and each of its files with the pinned sha256 and size, and each file
# is there with that size. A linked file's target can change after the fetch:
# it must also have the modification time the marker recorded for it (the
# fetch hashed it; it is not hashed again on every build, a 1.1 GB read). The
# size is the target's (file(SIZE) of a Windows symlink is the link's, 0).
# A folder without the marker (an interrupted or
# failed fetch, a copy made by hand) is not used. None is: SRC alone, as
# without INDEX, so a removed cache is unstaged again.
#
# INDEX as an index file of another name is compared byte for byte with the
# staged tax_k7.taxdb on every run (COPY=ON; file(COPY_FILE ...
# ONLY_IF_DIFFERENT)), so a switch to another file, one with an older time
# stamp, or one rewritten in place with the same size and time stamp is copied,
# and equal bytes are left alone.
#
# Every real folder the script makes carries .fastag-staged, which lists the
# top-level entries it staged there; only those are ever replaced or removed.
# A real folder at DST without the marker is the user's, in both modes, and is
# left alone (also a folder copy-staged before the marker existed: delete it
# to restage).
# Run as a script (-P), the policies are those of this version: IN_LIST
# (CMP0057) and the rest, also on the oldest CMake the build supports.
cmake_minimum_required(VERSION 3.28)
if(NOT SRC OR NOT DST)
  message(FATAL_ERROR "stage-data.cmake: SRC and DST are required")
endif()
set(_mark "${DST}/.fastag-staged")
set(_from_index tax_k7.taxdb nodes.dmp names.dmp MANIFEST.json)

# @p folder holds a complete fetch of the manifest @p manifest
# (tools/fetch_taxonomy_index.py fetched_complete): its marker names that
# manifest by data release and sha256, lists each of the manifest's files with
# its pinned sha256 and size, and each is a regular file of that size there.
function(_fastag_fetch_complete folder manifest out)
  set(${out} OFF PARENT_SCOPE)
  set(_m "${folder}/.fastag-fetched")
  if(NOT EXISTS "${_m}" OR IS_SYMLINK "${_m}" OR IS_DIRECTORY "${_m}" OR NOT EXISTS "${manifest}")
    return()
  endif()
  file(SHA256 "${manifest}" _msha)
  file(READ "${manifest}" _json)
  string(JSON _release ERROR_VARIABLE _err GET "${_json}" data_release)
  if(_err)
    return()
  endif()
  file(STRINGS "${_m}" _lines)
  if(NOT "manifest ${_release} ${_msha}" IN_LIST _lines)
    return()
  endif()
  string(JSON _n ERROR_VARIABLE _err LENGTH "${_json}" files)
  if(_err OR _n EQUAL 0)
    return()
  endif()
  math(EXPR _last "${_n} - 1")
  foreach(_k RANGE ${_last})
    string(JSON _name MEMBER "${_json}" files ${_k})
    string(JSON _sha GET "${_json}" files "${_name}" sha256)
    string(JSON _bytes ERROR_VARIABLE _nob GET "${_json}" files "${_name}" bytes)
    set(_f "${folder}/${_name}")
    if(NOT EXISTS "${_f}" OR IS_DIRECTORY "${_f}")
      return()
    endif()
    # A linked file (fetch --from without --copy) is the file it links to:
    # its size and time stamp are the target's. file(SIZE) does not follow a
    # symlink on Windows (it reports the link itself, 0 bytes).
    set(_real "${_f}")
    if(IS_SYMLINK "${_f}")
      file(REAL_PATH "${_f}" _real)
    endif()
    file(SIZE "${_real}" _size)
    if(NOT "file ${_name} ${_size} ${_sha}" IN_LIST _lines OR (NOT _nob AND NOT _size EQUAL _bytes))
      return()
    endif()
    # The target can change after the fetch at the same size: it must have
    # the modification time the fetch recorded when it hashed it.
    if(IS_SYMLINK "${_f}")
      file(TIMESTAMP "${_real}" _mtime "%s" UTC)
      if(NOT "link ${_name} ${_mtime}" IN_LIST _lines)
        return()
      endif()
    endif()
  endforeach()
  set(${out} ON PARENT_SCOPE)
endfunction()

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
    else()
      # An index file under another name, copied as tax_k7.taxdb whenever
      # its bytes differ from the staged copy's: no time-stamp shortcut, which
      # an in-place rewrite of the same size and second would pass.
      file(COPY_FILE "${from}" "${to}" ONLY_IF_DIFFERENT)
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
  string(REPLACE "|" ";" _search_man "${INDEX_MANIFESTS}")
  list(LENGTH _search _ns)
  list(LENGTH _search_man _nm)
  if(NOT _ns EQUAL _nm)
    message(FATAL_ERROR "stage-data.cmake: INDEX_SEARCH names ${_ns} folders and INDEX_MANIFESTS ${_nm} manifests")
  endif()
  math(EXPR _last "${_ns} - 1")
  foreach(_k RANGE ${_last})
    list(GET _search ${_k} _c)
    list(GET _search_man ${_k} _cm)
    _fastag_fetch_complete("${_c}" "${_cm}" _ok)
    if(_ok)
      set(INDEX "${_c}")
      break()
    elseif(EXISTS "${_c}/tax_k7.taxdb")
      message(STATUS "stage-data.cmake: ${_c} holds no complete fetch of ${_cm} (no matching .fastag-fetched); "
                     "not staged (run tools/fetch_taxonomy_index.py)")
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
