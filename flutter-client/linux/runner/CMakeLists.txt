cmake_minimum_required(VERSION 3.13)
project(runner LANGUAGES CXX)

# Define the application target. To change its name, change BINARY_NAME in the
# top-level CMakeLists.txt, not the value here, or `flutter run` will no longer
# work.
#
# Any new source files that you add to the application should be added here.
add_executable(${BINARY_NAME}
  "main.cc"
  "my_application.cc"
  "${FLUTTER_MANAGED_DIR}/generated_plugin_registrant.cc"
)

find_program(GLIB_COMPILE_RESOURCES NAMES glib-compile-resources REQUIRED)
set(TUNEFLOW_RESOURCE_SOURCE "${CMAKE_CURRENT_BINARY_DIR}/tuneflow_resources.cc")
add_custom_command(
  OUTPUT "${TUNEFLOW_RESOURCE_SOURCE}"
  COMMAND ${GLIB_COMPILE_RESOURCES}
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/tuneflow.gresource.xml"
    --sourcedir="${CMAKE_CURRENT_SOURCE_DIR}/resources"
    --generate-source
    --target="${TUNEFLOW_RESOURCE_SOURCE}"
    --c-name=tuneflow
  DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/tuneflow.gresource.xml"
    "${CMAKE_CURRENT_SOURCE_DIR}/resources/tuneflow.png"
  VERBATIM
)
target_sources(${BINARY_NAME} PRIVATE "${TUNEFLOW_RESOURCE_SOURCE}")

# Apply the standard set of build settings. This can be removed for applications
# that need different build settings.
apply_standard_settings(${BINARY_NAME})

# Add preprocessor definitions for the application ID.
add_definitions(-DAPPLICATION_ID="${APPLICATION_ID}")

# Add dependency libraries. Add any application-specific dependencies here.
target_link_libraries(${BINARY_NAME} PRIVATE flutter)
target_link_libraries(${BINARY_NAME} PRIVATE PkgConfig::GTK)

target_include_directories(${BINARY_NAME} PRIVATE "${CMAKE_SOURCE_DIR}")
