#include <iostream>
int main() {
  int n = {{n}};
  int values[12];
  for (int i = 0; i < n; i = i + 1) { std::cin >> values[i]; }
  int target;
  std::cin >> target;
  int left = 0;
  int right = n - 1;
  int answer = n;
  while (left <= right) {
    int middle = left + (right - left) / 2;
    if (values[middle] >= target) {
      answer = middle;
      right = middle - 1;
    } else {
      left = middle + 1;
    }
  }
  std::cout << answer << "\n";
  return 0;
}
