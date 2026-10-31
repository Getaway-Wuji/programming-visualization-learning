#include <iostream>
int main() {
  int n = {{n}};
  int values[12];
  int order[12];
  int scratch[12];
  for (int i = 0; i < n; i = i + 1) {
    std::cin >> values[i];
    order[i] = i;
  }
  int target;
  std::cin >> target;
  // Merge original indices, leaving values in its original order.
  for (int width = 1; width < n; width = width * 2) {
    for (int start = 0; start < n; start = start + width * 2) {
      int middle = start + width;
      if (middle > n) { middle = n; }
      int end = start + width * 2;
      if (end > n) { end = n; }
      int left = start;
      int right = middle;
      int write = start;
      while (left < middle && right < end) {
        if (values[order[left]] <= values[order[right]]) {
          scratch[write] = order[left];
          left = left + 1;
        } else {
          scratch[write] = order[right];
          right = right + 1;
        }
        write = write + 1;
      }
      while (left < middle) {
        scratch[write] = order[left];
        left = left + 1;
        write = write + 1;
      }
      while (right < end) {
        scratch[write] = order[right];
        right = right + 1;
        write = write + 1;
      }
      for (int i = start; i < end; i = i + 1) { order[i] = scratch[i]; }
    }
  }
  int left = 0;
  int right = n - 1;
  int pairs = 0;
  int answerLeft = -1;
  int answerRight = -1;
  while (left < right) {
    int sum = values[order[left]] + values[order[right]];
    if (sum < target) {
      left = left + 1;
    } else {
      if (sum > target) {
        right = right - 1;
      } else {
        if (pairs == 0) {
          answerLeft = order[left];
          answerRight = order[right];
          if (answerLeft > answerRight) {
            int temp = answerLeft;
            answerLeft = answerRight;
            answerRight = temp;
          }
        }
        int leftValue = values[order[left]];
        int rightValue = values[order[right]];
        if (leftValue == rightValue) {
          int count = right - left + 1;
          pairs = pairs + count * (count - 1) / 2;
          break;
        }
        int leftCount = 0;
        int rightCount = 0;
        while (left <= right && values[order[left]] == leftValue) {
          leftCount = leftCount + 1;
          left = left + 1;
        }
        while (left <= right && values[order[right]] == rightValue) {
          rightCount = rightCount + 1;
          right = right - 1;
        }
        pairs = pairs + leftCount * rightCount;
      }
    }
  }
  if (pairs != 1) { std::cout << "INVALID_INPUT\n"; return 1; }
  std::cout << answerLeft << " " << answerRight << "\n";
  return 0;
}
