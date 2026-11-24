# Puts one shipped data folder beside the built FASTag (CMakeLists.txt,
# FASTAG_STAGE_DATA_IN_BUILD): cmake -DSRC=<data/x> -DDST=<bin dir>/share-FASTag-x
# [-DCOPY=ON] [-DINDEX=<folder>] -P stage-data.cmake.
#
# A symlink to SRC (it follows edits to data/), or a copy with COPY=ON
# (Windows, where a symlink needs Developer Mode). A real folder already at
# DST is the user's own and is left alone.
#
# INDEX (the taxonomy, FASTAG_TAXONOMY_INDEX_DIR): a folder holding the k-mer
# index tax_k7.taxdb and the dumps it was built from, as the release asset
# FASTag-<version>-taxonomy-k7.tar.gz unpacks. DST is then a folder of its own
# (marked .fastag-staged): every file of SRC, with tax_k7.taxdb, nodes.dmp,
# names.dmp and MANIFEST.json from INDEX in place of the repo's, as the
# release workflows assemble share-FASTag-taxonomy. Each is a link, or a copy
# with COPY=ON (copied again only when it changed).
if(NOT SRC OR NOT DST)
  message(FATAL_ERROR "stage-data.cmake: SRC and DST are required")
endif()
set(_mark "${DST}/.fastag-staged")

# Link (or copy) @p from to @p to.
function(_fastag_put from to)
  if(COPY)
    if(IS_SYMLINK "${to}")
      file(REMOVE "${to}")
    endif()
    get_filename_component(_dir "${to}" DIRECTORY)
    file(COPY "${from}" DESTINATION "${_dir}")
  else()
    if(IS_SYMLINK "${to}" OR EXISTS "${to}")
      file(REMOVE_RECURSE "${to}")
    endif()
    file(CREATE_LINK "${from}" "${to}" SYMBOLIC)
  endif()
endfunction()

if(INDEX)
  if(NOT EXISTS "${INDEX}/tax_k7.taxdb")
    message(FATAL_ERROR "stage-data.cmake: no tax_k7.taxdb in '${INDEX}' (FASTAG_TAXONOMY_INDEX_DIR)")
  endif()
  if(IS_SYMLINK "${DST}")
    file(REMOVE "${DST}")
  elseif(EXISTS "${DST}" AND NOT EXISTS "${_mark}" AND NOT COPY)
    message(STATUS "stage-data.cmake: ${DST} is a folder of its own; it is kept (the index in ${INDEX} is not staged)")
    return()
  endif()
  file(MAKE_DIRECTORY "${DST}")
  set(_from_index tax_k7.taxdb nodes.dmp names.dmp MANIFEST.json)
  file(GLOB _items RELATIVE "${SRC}" "${SRC}/*")
  foreach(_i IN LISTS _items)
    list(FIND _from_index "${_i}" _k)
    if(_k LESS 0 OR NOT EXISTS "${INDEX}/${_i}")
      _fastag_put("${SRC}/${_i}" "${DST}/${_i}")
    endif()
  endforeach()
  foreach(_i IN LISTS _from_index)
    if(EXISTS "${INDEX}/${_i}")
      _fastag_put("${INDEX}/${_i}" "${DST}/${_i}")
    endif()
  endforeach()
  file(WRITE "${_mark}" "Staged by cmake/stage-data.cmake from ${SRC} and ${INDEX}.\n")
  return()
endif()

# A folder staged with an index before, and now without one: it is ours.
if(NOT IS_SYMLINK "${DST}" AND EXISTS "${_mark}")
  file(REMOVE_RECURSE "${DST}")
endif()
if(COPY)
  if(IS_SYMLINK "${DST}")
    file(REMOVE "${DST}")
  endif()
  file(COPY "${SRC}/" DESTINATION "${DST}")
  return()
endif()
if(IS_SYMLINK "${DST}")
  file(READ_SYMLINK "${DST}" _target)
  if(_target STREQUAL SRC)
    return()
  endif()
  file(REMOVE "${DST}")
elseif(EXISTS "${DST}")
  message(STATUS "stage-data.cmake: ${DST} is a folder of its own; it is kept (not linked to ${SRC})")
  return()
endif()
file(CREATE_LINK "${SRC}" "${DST}" SYMBOLIC)
