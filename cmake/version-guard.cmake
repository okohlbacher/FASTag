# Every file that carries FASTag's version must agree with
# project(FASTag VERSION ...) in CMakeLists.txt:
#
#   gui/package.json               the frontend package
#   gui/src-tauri/tauri.conf.json  stamps the desktop bundle (.app / .dmg / .exe)
#   gui/src-tauri/Cargo.toml       the Tauri backend crate
#   gui/package-lock.json          npm's two copies of package.json's version
#   gui/src-tauri/Cargo.lock       cargo's copy of Cargo.toml's version
#
# Nothing reads Cargo.toml's number, so it sat at 1.2.1 through three releases
# (package-lock.json's at 0.19.1) and nobody noticed; v1.4.1 shipped
# announcing OpenMS's version because nothing checked that either. This runs
# at configure time, so the first cmake after a bump -- on a developer's
# machine or on any CI leg, all of which configure -- fails when a file was
# missed. It is skipped only when gui/ is absent altogether (a CLI-only source
# package); a single missing file is an error.
#
# Versions are plain MAJOR.MINOR.PATCH everywhere: project(VERSION) accepts
# nothing else, and the comparison is textual, so "1.4.2.0" or "1.4.2-rc1"
# do not pass as 1.4.2.
#
# To repair: edit the source files, then `npm install --package-lock-only` in
# gui/ and `cargo update -p fastag --offline` in gui/src-tauri/ rewrite the
# locks (each is also a one-line hand edit).

# The little TOML that cargo writes: the `version` key of the table whose
# header line matches `header` (a regex), and -- for Cargo.lock's repeated
# [[package]] blocks -- only of the block whose `name` is `name` ("" = any).
# Line-based, so key order, indentation, quote style and arrays in other keys
# do not matter; a dotted or inline-table version (version.workspace = true)
# is not a version and is reported as missing.
function(_fastag_toml_version text header name out)
  string(REGEX REPLACE ";" "\\\;" text "${text}")
  string(REPLACE "\n" ";" lines "${text}")
  set(in_table FALSE)
  set(block_name "")
  set(block_version "")
  foreach(line IN LISTS lines)
    if(line MATCHES "^[ \t]*\\[")
      # Any table header ends the previous table.
      if(line MATCHES "^[ \t]*${header}[ \t]*(#.*)?$")
        set(in_table TRUE)
      else()
        set(in_table FALSE)
      endif()
      set(block_name "")
      set(block_version "")
    elseif(in_table)
      if(line MATCHES "^[ \t]*name[ \t]*=[ \t]*[\"']([^\"']*)[\"']")
        set(block_name "${CMAKE_MATCH_1}")
      elseif(line MATCHES "^[ \t]*version[ \t]*=[ \t]*[\"']([^\"']*)[\"']")
        set(block_version "${CMAKE_MATCH_1}")
      endif()
      if(NOT block_version STREQUAL "" AND (name STREQUAL "" OR block_name STREQUAL name))
        set(${out} "${block_version}" PARENT_SCOPE)
        return()
      endif()
    endif()
  endforeach()
  set(${out} "" PARENT_SCOPE)
endfunction()

function(fastag_version_guard want root)
  if(NOT IS_DIRECTORY "${root}/gui")
    message(STATUS "FASTag: no gui/ in this source tree -- version guard skipped")
    return()
  endif()
  # file, how to read it, how many versions it must carry
  set(pending
    gui/package.json               json      1
    gui/src-tauri/tauri.conf.json  json      1
    gui/package-lock.json          npm-lock  2
    gui/src-tauri/Cargo.toml       toml      1
    gui/src-tauri/Cargo.lock       cargo-lock 1)
  set(checked "CMakeLists.txt")
  while(pending)
    list(POP_FRONT pending file kind expect)
    set(path "${root}/${file}")
    if(NOT EXISTS "${path}")
      message(FATAL_ERROR "FASTag version guard: ${file} is missing")
    endif()
    # Re-run the check when one of them changes, not only when CMakeLists.txt does.
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${path}")
    file(READ "${path}" text)
    string(REPLACE "\r" "" text "${text}") # a CRLF checkout on Windows
    set(found "")
    if(kind STREQUAL "json" OR kind STREQUAL "npm-lock")
      # A real parser: the top-level "version" member, whatever the formatting.
      string(JSON v ERROR_VARIABLE err GET "${text}" version)
      if(NOT err)
        list(APPEND found "${v}")
      endif()
      if(kind STREQUAL "npm-lock")
        # npm writes the root version a second time, under packages[""].
        string(JSON v ERROR_VARIABLE err GET "${text}" packages "" version)
        if(NOT err)
          list(APPEND found "${v}")
        endif()
      endif()
    elseif(kind STREQUAL "toml")
      _fastag_toml_version("${text}" "\\[package\\]" "" v)
      if(NOT v STREQUAL "")
        list(APPEND found "${v}")
      endif()
    else()
      _fastag_toml_version("${text}" "\\[\\[package\\]\\]" "fastag" v)
      if(NOT v STREQUAL "")
        list(APPEND found "${v}")
      endif()
    endif()
    list(LENGTH found n)
    if(NOT n EQUAL expect)
      message(FATAL_ERROR "FASTag version guard: cannot find the version in ${file} (expected ${expect}, found ${n})")
    endif()
    foreach(v IN LISTS found)
      if(NOT v STREQUAL want)
        message(FATAL_ERROR
          "FASTag version guard: ${file} says ${v} but CMakeLists.txt says ${want}. "
          "A bump touches CMakeLists.txt, gui/package.json, gui/src-tauri/tauri.conf.json "
          "and gui/src-tauri/Cargo.toml, then the two lock files -- see cmake/version-guard.cmake.")
      endif()
    endforeach()
    list(APPEND checked "${file}")
  endwhile()
  list(JOIN checked ", " checked)
  message(STATUS "FASTag: version ${want} agrees across ${checked}")
endfunction()

fastag_version_guard("${PROJECT_VERSION}" "${CMAKE_CURRENT_SOURCE_DIR}")
