#include <iostream>
int main() {
  int n = {{n}};
  int values[12];
  for (int i = 0; i < n; i = i + 1) { std::cin >> values[i]; }
  int write = 0;
  for (int read = 0; read < n; read = read + 1) {
    if (values[read] != 0) {
      if (write != read) {
        int temp = values[write];
        values[write] = values[read];
        values[read] = temp;
      }
      write = write + 1;
    }
  }
  for (int i = 0; i < n; i = i + 1) {
    if (i > 0) { std::cout << " "; }
    std::cout << values[i];
  }
  std::cout << "\n";
  return 0;
}
