cmake_minimum_required(VERSION 3.20)
project(miniContainer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_compile_options(-Wall -Wextra -Werror -O2)

add_executable(miniContainer
  src/main.cpp
  src/container.cpp
  src/cgroup.cpp
  src/network.cpp
)

target_include_directories(miniContainer PRIVATE include)
target_compile_definitions(miniContainer PRIVATE _GNU_SOURCE)
