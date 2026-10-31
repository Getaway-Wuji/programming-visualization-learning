#include <iostream>

int main() {
  int n = {{n}};
  int values[12];
  for (int i = 0; i < n; i = i + 1) {
    std::cin >> values[i];
  }
  int write = 0;
  for (int read = 0; read < n; read = read + 1) {
    if (values[read] != 0) {
      values[write] = values[read];
      write = write + 1;
    }
  }
  for (int i = write; i < n; i = i + 1) {
    values[i] = 0;
  }
  for (int i = 0; i < n; i = i + 1) {
    if (i > 0) {
      std::cout << " ";
    }
    std::cout << values[i];
  }
  std::cout << "\n";
  return 0;
}
